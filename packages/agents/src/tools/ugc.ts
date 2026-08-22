import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema } from "@falorb/db";
import {
  DEFAULT_PROMPT_MODEL_ID,
  getVideoModel,
  videoModelsFor,
  type VideoModelSpec,
} from "@falorb/elevenlabs-client";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * UGC video generation (FEATURES.md §18) — text-to-video only.
 *
 * `createUgcVideo` in `apps/web/src/server/actions/ugc-videos.ts` supports
 * two modes: "avatar" (a presenter photo + a cloned voice, lip-synced) and
 * "prompt" (a shot description, nothing else). An agent has no photo to
 * upload and no way to pick a voice it has actually listened to, so this
 * toolkit only ever submits prompt-mode requests — the same restriction a
 * human would face if they skipped the composer's voice/photo fields.
 *
 * Both tools only ever touch a `status: "pending"` row (or a post-queue
 * checklist entry, per `ugcVideoPostQueue`'s own doc comment — nothing here
 * actually publishes anywhere on the org's behalf). The real script/video
 * generation is entirely `apps/worker/src/jobs/ugc-video-gen.ts`'s job, so
 * neither tool needs to know anything about ElevenLabs itself.
 */

export const ugcTools: AnyToolDefinition[] = [
  defineTool({
    name: "list_ugc_videos",
    toolkit: "ugc",
    description: "UGC videos generated or in progress, most recent first.",
    input: z.object({
      status: z.enum(["pending", "processing", "ready", "failed"]).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `List ${a.status ?? "all"} UGC videos`,
    execute: async (ctx, a) => {
      const conditions = [eq(schema.ugcVideos.organizationId, ctx.organizationId)];
      if (a.status) conditions.push(eq(schema.ugcVideos.status, a.status));
      return ctx.db
        .select({
          id: schema.ugcVideos.id,
          brief: schema.ugcVideos.brief,
          mode: schema.ugcVideos.mode,
          videoModel: schema.ugcVideos.videoModel,
          status: schema.ugcVideos.status,
          videoUrl: schema.ugcVideos.videoUrl,
          createdAt: schema.ugcVideos.createdAt,
        })
        .from(schema.ugcVideos)
        .where(and(...conditions))
        .orderBy(desc(schema.ugcVideos.createdAt))
        .limit(a.limit);
    },
  }),

  defineTool({
    name: "generate_ugc_video",
    toolkit: "ugc",
    description:
      "Queue a text-to-video UGC clip from a shot description. Generation happens in the " +
      "background and can take a few minutes — check back with list_ugc_videos. Requires " +
      "ElevenLabs to be connected; if it isn't, this refuses and says so.",
    input: z.object({
      brief: z.string().min(5).max(2000).describe("What the video should sell — the product, offer or angle."),
      videoPrompt: z.string().min(5).max(2000).describe("The shot description sent to the video model."),
      projectSlug: z.string().optional(),
      videoModel: z.string().default(DEFAULT_PROMPT_MODEL_ID),
    }),
    capability: "manageUgcVideos",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Generate UGC video: ${a.brief.slice(0, 60)}`,
    execute: async (ctx: AgentContext, a) => {
      const model = getVideoModel(a.videoModel);
      if (!model || model.input !== "prompt") {
        throw new Error(
          `"${a.videoModel}" is not a text-to-video model. Choose one of: ` +
            videoModelsFor("prompt").map((m: VideoModelSpec) => m.id).join(", "),
        );
      }

      const [connection] = await ctx.db
        .select({ status: schema.integrationConnections.status })
        .from(schema.integrationConnections)
        .where(
          and(
            eq(schema.integrationConnections.organizationId, ctx.organizationId),
            isNull(schema.integrationConnections.projectId),
            eq(schema.integrationConnections.provider, "elevenlabs"),
          ),
        )
        .limit(1);
      if (!connection || connection.status !== "active") {
        throw new Error("ElevenLabs is not connected for this workspace — hand this to a human to connect it.");
      }

      const project = a.projectSlug
        ? ctx.projects.find((p) => p.slug.toLowerCase() === a.projectSlug!.toLowerCase())
        : undefined;
      if (a.projectSlug && !project) throw new Error(`Unknown property "${a.projectSlug}".`);

      const [row] = await ctx.db
        .insert(schema.ugcVideos)
        .values({
          organizationId: ctx.organizationId,
          projectId: project?.id ?? null,
          mode: "prompt",
          brief: a.brief,
          videoPrompt: a.videoPrompt,
          videoModel: model.id,
          generateAudio: model.supportsGeneratedAudio,
          status: "pending",
        })
        .returning({ id: schema.ugcVideos.id });

      ctx.log(`Queued a UGC video: ${a.brief.slice(0, 60)}`);
      return { videoId: row!.id, note: "Generating in the background — check list_ugc_videos for progress." };
    },
  }),

  defineTool({
    name: "queue_ugc_video_for_posting",
    toolkit: "ugc",
    description:
      "Add a finished video to the posting checklist for a platform. This only tracks intent " +
      "to post — Falorb does not publish it anywhere itself; a person still posts it manually " +
      "and marks it done.",
    input: z.object({
      videoId: z.string().uuid(),
      platform: z.enum([
        "tiktok",
        "instagram_reels",
        "youtube_shorts",
        "linkedin",
        "x",
        "facebook",
      ]),
      caption: z.string().max(2000).optional(),
    }),
    capability: "manageUgcVideos",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Queue video ${a.videoId.slice(0, 8)} for ${a.platform}`,
    execute: async (ctx, a) => {
      const [video] = await ctx.db
        .select({ id: schema.ugcVideos.id, status: schema.ugcVideos.status })
        .from(schema.ugcVideos)
        .where(
          and(eq(schema.ugcVideos.id, a.videoId), eq(schema.ugcVideos.organizationId, ctx.organizationId)),
        )
        .limit(1);
      if (!video) throw new Error("No such video.");
      if (video.status !== "ready") throw new Error("This video hasn't finished generating yet.");

      await ctx.db.insert(schema.ugcVideoPostQueue).values({
        organizationId: ctx.organizationId,
        videoId: a.videoId,
        platform: a.platform,
        caption: a.caption ?? null,
        status: "queued",
      });

      return { ok: true };
    },
  }),
];
