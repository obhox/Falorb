import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema } from "@falorb/db";
import { VIDEO_MODELS, getVideoModel, type VideoModelSpec } from "@falorb/elevenlabs-client";
import type { McpContext } from "../context";
import { requireScope } from "../context";
import { ago, failure, table, text } from "../format";

const MAX_PRESENTER_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * UGC AI video generation (FEATURES.md §18) — script, voiceover, and a
 * lip-synced talking video via ElevenLabs, or a straight text-to-video
 * generation, depending on the chosen model's `input` kind.
 *
 * `create_ugc_video` mirrors `apps/web/src/server/actions/ugc-videos.ts`'s
 * `createUgcVideo` exactly: it only ever inserts a `status: "pending"` row.
 * Generation itself is entirely `apps/worker/src/jobs/ugc-video-gen.ts`'s
 * job — a multi-minute, multi-stage ElevenLabs chain has no place inside a
 * tool call's request/response cycle, and re-checking progress is what
 * get_ugc_video is for.
 *
 * This spends a connected org's own paid ElevenLabs credits per call — the
 * same class of cost `draft_content_page`/`regenerate_signal`/`run_agent_now`
 * already carry elsewhere in this server. Call it deliberately, with a real
 * brief, never as a bulk sweep of variations.
 */
export function registerUgcVideoTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_ugc_video_models",
    {
      title: "List available video models",
      description:
        "The video model catalog — which models Falorb offers, whether each needs a presenter " +
        "photo and voice (avatar) or just a shot description (prompt), and what resolutions/" +
        "aspect ratios/durations each supports. Check this before calling create_ugc_video, since " +
        "what's required depends entirely on the chosen model.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      return text(
        table(VIDEO_MODELS, [
          { header: "Id", get: (m) => m.id },
          { header: "Label", get: (m) => m.label },
          { header: "Vendor", get: (m) => m.vendor },
          { header: "Input", get: (m) => m.input },
          { header: "Blurb", get: (m) => m.blurb },
          { header: "Resolutions", get: (m) => m.resolutions.join(", ") },
          { header: "Aspect ratios", get: (m) => m.aspectRatios.join(", ") || "follows photo" },
          { header: "Durations (s)", get: (m) => m.durations.join(", ") || "follows voiceover" },
          { header: "Self-scored audio", get: (m) => (m.supportsGeneratedAudio ? "yes" : "no") },
        ]) +
          '\n\n"avatar" models need `voice_id` and a presenter photo; "prompt" models need neither.',
      );
    },
  );

  server.registerTool(
    "list_ugc_videos",
    {
      title: "List UGC videos",
      description: "Org-wide list of generated/generating UGC videos, newest first.",
      inputSchema: {
        status: z
          .enum(["pending", "script_ready", "voice_ready", "prompt_ready", "video_processing", "ready", "failed"])
          .optional(),
        project: z.string().optional().describe("Project slug tag, if any."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, project, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.ugcVideos.organizationId, scope.organizationId)];
        if (status) conditions.push(eq(schema.ugcVideos.status, status));
        if (project) {
          const match = scope.projects.find((p) => p.slug.toLowerCase() === project.toLowerCase());
          if (!match) return failure(`Unknown project "${project}".`);
          conditions.push(eq(schema.ugcVideos.projectId, match.id));
        }

        const rows = await db
          .select()
          .from(schema.ugcVideos)
          .where(and(...conditions))
          .orderBy(desc(schema.ugcVideos.createdAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Brief", get: (r) => r.brief },
              { header: "Mode", get: (r) => r.mode },
              { header: "Model", get: (r) => r.videoModel },
              { header: "Status", get: (r) => r.status },
              { header: "Error", get: (r) => r.lastError },
              { header: "Created", get: (r) => ago(r.createdAt.toISOString()) },
            ],
            "No videos yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_ugc_video",
    {
      title: "Read a UGC video",
      description: "One video's full state: brief, script or shot description, status, and the finished video URL once ready.",
      inputSchema: { video_id: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ video_id }) => {
      const { db, scope } = ctx();
      try {
        const [row] = await db
          .select()
          .from(schema.ugcVideos)
          .where(and(eq(schema.ugcVideos.id, video_id), eq(schema.ugcVideos.organizationId, scope.organizationId)))
          .limit(1);
        if (!row) return failure("No such video.");

        const lines = [
          `# UGC video \`${row.id}\` — ${row.status}`,
          "",
          `Mode: ${row.mode}  ·  Model: ${row.videoModel}`,
          `Brief: ${row.brief}`,
          row.script ? `\nScript:\n${row.script}` : null,
          row.videoPrompt ? `\nShot description:\n${row.videoPrompt}` : null,
          row.voiceName
            ? `\nVoice: ${row.voiceName}${row.voiceProvider === "gemini" ? " (ElevenLabs unavailable — voiced by Gemini fallback instead)" : ""}`
            : null,
          row.videoUrl ? `\nVideo: ${row.videoUrl}` : null,
          row.durationSeconds ? `Duration: ${row.durationSeconds}s` : null,
          row.lastError ? `\nError: ${row.lastError}` : null,
        ].filter((l): l is string => l !== null);

        return text(lines.join("\n"));
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_ugc_video",
    {
      title: "Generate a UGC video",
      description:
        "Start generating a UGC-style video — script, voiceover, and a lip-synced talking video " +
        "for an \"avatar\" model, or a straight text-to-video generation for a \"prompt\" model. " +
        "Returns immediately with a pending row; generation runs over several worker ticks and can " +
        "take a few minutes — poll get_ugc_video for progress. Spends real ElevenLabs credits. " +
        "Call list_ugc_video_models first to see what the chosen model requires. Requires the " +
        "write scope.",
      inputSchema: {
        brief: z.string().min(1).max(2000).describe("The product/offer/angle the video should sell."),
        video_model: z.string().describe("A model id from list_ugc_video_models."),
        project: z.string().optional().describe("Optional property/brand tag — not an ownership scope."),
        aspect_ratio: z.string().optional().describe("Must be one the model advertises; otherwise ignored."),
        resolution: z.string().optional().describe("Must be one the model advertises; otherwise ignored."),
        duration_secs: z.number().optional().describe("Must be one the model advertises; otherwise ignored."),
        voice_id: z.string().optional().describe("Required for an \"avatar\" model."),
        voice_name: z.string().optional().describe("Display name for the review page."),
        presenter_image_base64: z.string().optional().describe("Required for an \"avatar\" model — the presenter photo, base64-encoded, under 8MB decoded."),
        presenter_image_mime_type: z.string().optional().describe('Required alongside presenter_image_base64, e.g. "image/jpeg".'),
        generate_audio: z.boolean().optional().describe("\"prompt\" models only, if the model supports scoring its own audio."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({
      brief,
      video_model,
      project,
      aspect_ratio,
      resolution,
      duration_secs,
      voice_id,
      voice_name,
      presenter_image_base64,
      presenter_image_mime_type,
      generate_audio,
    }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const model = getVideoModel(video_model);
        if (!model) return failure(`Unknown video model "${video_model}". Call list_ugc_video_models to see valid ids.`);

        let projectId: number | null = null;
        if (project) {
          const match = scope.projects.find((p) => p.slug.toLowerCase() === project.toLowerCase());
          if (!match) return failure(`Unknown project "${project}".`);
          projectId = match.id;
        }

        const [connection] = await db
          .select({ status: schema.integrationConnections.status })
          .from(schema.integrationConnections)
          .where(
            and(
              eq(schema.integrationConnections.organizationId, scope.organizationId),
              isNull(schema.integrationConnections.projectId),
              eq(schema.integrationConnections.provider, "elevenlabs"),
            ),
          )
          .limit(1);
        if (!connection || connection.status !== "active") {
          return failure("ElevenLabs isn't connected. Connect it in Settings → Integrations.");
        }

        const framing = readFraming(model, aspect_ratio, resolution, duration_secs);

        const base = {
          organizationId: scope.organizationId,
          projectId,
          brief,
          videoModel: model.id,
          ...framing,
          status: "pending" as const,
        };

        if (model.input === "avatar") {
          if (!voice_id) return failure("voice_id is required for this model.");
          if (!presenter_image_base64 || !presenter_image_mime_type) {
            return failure("presenter_image_base64 and presenter_image_mime_type are required for this model.");
          }
          if (!presenter_image_mime_type.startsWith("image/")) {
            return failure("presenter_image_mime_type must be an image type, e.g. \"image/jpeg\".");
          }

          let decoded: Buffer;
          try {
            decoded = Buffer.from(presenter_image_base64, "base64");
          } catch {
            return failure("presenter_image_base64 is not valid base64.");
          }
          if (decoded.length === 0) return failure("presenter_image_base64 decoded to an empty image.");
          if (decoded.length > MAX_PRESENTER_IMAGE_BYTES) {
            return failure("Presenter photo is too large — keep it under 8MB decoded.");
          }

          const [created] = await db
            .insert(schema.ugcVideos)
            .values({
              ...base,
              mode: "avatar",
              voiceId: voice_id,
              voiceName: voice_name ?? null,
              presenterImageBase64: presenter_image_base64,
              presenterImageMimeType: presenter_image_mime_type,
              generateAudio: false,
            })
            .returning({ id: schema.ugcVideos.id });

          return text(`Generating (\`${created!.id}\`) — this can take a few minutes. Poll get_ugc_video for progress.`);
        }

        const [created] = await db
          .insert(schema.ugcVideos)
          .values({
            ...base,
            mode: "prompt",
            generateAudio: model.supportsGeneratedAudio && generate_audio === true,
          })
          .returning({ id: schema.ugcVideos.id });

        return text(`Generating (\`${created!.id}\`) — this can take a few minutes. Poll get_ugc_video for progress.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "queue_ugc_video_post",
    {
      title: "Queue a video for posting",
      description:
        "Add a finished video to the human-curated \"post this\" queue for a platform. This does " +
        "not post anywhere itself — Falorb has no automated social posting for UGC video (see " +
        "FEATURES.md §18) — it's a to-do list a person clears by posting manually and marking it " +
        "done. Requires the write scope.",
      inputSchema: {
        video_id: z.string().uuid(),
        platform: z.string().describe('e.g. "tiktok", "instagram_reels", "youtube_shorts", "linkedin", "x", "facebook".'),
        caption: z.string().optional(),
        scheduled_at: z.string().optional().describe("ISO date/time — a target, not an automated post time."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ video_id, platform, caption, scheduled_at }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [video] = await db
          .select({ id: schema.ugcVideos.id, status: schema.ugcVideos.status })
          .from(schema.ugcVideos)
          .where(and(eq(schema.ugcVideos.id, video_id), eq(schema.ugcVideos.organizationId, scope.organizationId)))
          .limit(1);
        if (!video) return failure("No such video.");
        if (video.status !== "ready") return failure("This video hasn't finished generating yet.");

        let scheduledAt: Date | null = null;
        if (scheduled_at) {
          scheduledAt = new Date(scheduled_at);
          if (Number.isNaN(scheduledAt.getTime())) return failure(`"${scheduled_at}" is not a valid date/time.`);
        }

        const [created] = await db
          .insert(schema.ugcVideoPostQueue)
          .values({
            organizationId: scope.organizationId,
            videoId: video_id,
            platform,
            caption: caption ?? null,
            scheduledAt,
            status: "queued",
          })
          .returning({ id: schema.ugcVideoPostQueue.id });

        return text(`Queued for ${platform}, id \`${created!.id}\`.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_ugc_post_status",
    {
      title: "Mark a queued post posted or canceled",
      description: "Update a post-queue entry once a person has actually posted it elsewhere, or to cancel it. Requires the write scope.",
      inputSchema: {
        entry_id: z.string().uuid().describe("From queue_ugc_video_post, or the video's queue."),
        status: z.enum(["posted", "canceled"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ entry_id, status }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [updated] = await db
          .update(schema.ugcVideoPostQueue)
          .set({ status, updatedAt: new Date() })
          .where(and(eq(schema.ugcVideoPostQueue.id, entry_id), eq(schema.ugcVideoPostQueue.organizationId, scope.organizationId)))
          .returning({ id: schema.ugcVideoPostQueue.id });
        if (!updated) return failure("No such queue entry.");

        return text(status === "posted" ? "Marked as posted." : "Canceled.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function readFraming(
  model: VideoModelSpec,
  aspectRatio: string | undefined,
  resolution: string | undefined,
  durationSecs: number | undefined,
) {
  return {
    aspectRatio: aspectRatio && model.aspectRatios.some((r) => r === aspectRatio) ? aspectRatio : null,
    resolution: resolution && model.resolutions.some((r) => r === resolution) ? resolution : null,
    requestedDurationSecs:
      durationSecs !== undefined && model.durations.includes(durationSecs) ? durationSecs : null,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
