"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { getVideoModel, type VideoModelSpec } from "@falorb/elevenlabs-client";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

const MAX_PRESENTER_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Mutations for the org-wide `/ugc-videos` pages (FEATURES.md §18). Scoped
 * by `organizationId` only, same reasoning as `prospects.ts`'s actions — a
 * video's `projectId` is an optional tag, not an ownership scope.
 *
 * `createUgcVideo` only ever inserts a `status: "pending"` row; the actual
 * script/voice/video generation is entirely the worker job's job
 * (`apps/worker/src/jobs/ugc-video-gen.ts`) — a multi-minute ElevenLabs
 * chain has no place inside a request/response cycle. The review page picks
 * up progress via `revalidatePath`-driven refetches, not by awaiting
 * anything here.
 *
 * What a submission must contain depends on the chosen model, so validation
 * is driven by that model's entry in `VIDEO_MODELS` rather than by a fixed
 * field list: an avatar model needs a voice and a presenter photo, a prompt
 * model needs neither and instead takes framing the avatar model has no use
 * for. The composer renders from the same catalog, so this is re-deriving
 * the client's own rules server-side rather than trusting them — the same
 * posture every other mutation here takes toward the browser.
 */

export async function createUgcVideo(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageUgcVideos", "generate a UGC video");
  if (refusal) return refusal;

  const brief = String(formData.get("brief") ?? "").trim();
  if (!brief) return { ok: false, message: "Describe what the video should be about." };
  if (brief.length > 2000) return { ok: false, message: "Keep the brief under 2000 characters." };

  const model = getVideoModel(String(formData.get("videoModel") ?? "").trim());
  if (!model) return { ok: false, message: "Choose a video model." };

  const projectIdRaw = String(formData.get("projectId") ?? "").trim();
  const projectId = projectIdRaw ? Number(projectIdRaw) : null;
  if (projectId !== null) {
    const owned = session.projects.some((p) => p.id === projectId);
    if (!owned) return { ok: false, message: "That property is not in your workspace." };
  }

  const [connection] = await db()
    .select({ status: schema.integrationConnections.status })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, session.workspace.organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "elevenlabs"),
      ),
    )
    .limit(1);
  if (!connection || connection.status !== "active") {
    return {
      ok: false,
      message: "Connect ElevenLabs first, under Settings → Integrations.",
    };
  }

  // Only ever one of the model's own advertised values, never whatever the
  // form posted: an unsupported combination would otherwise be spent on a
  // billed generation before ElevenLabs rejected it.
  const framing = readFraming(formData, model);

  const values = {
    organizationId: session.workspace.organizationId,
    projectId,
    brief,
    videoModel: model.id,
    ...framing,
    status: "pending" as const,
    createdBy: session.user.id,
  };

  if (model.input === "avatar") {
    const voiceId = String(formData.get("voiceId") ?? "").trim();
    if (!voiceId) return { ok: false, message: "Pick a voice for the presenter." };
    const voiceName = String(formData.get("voiceName") ?? "").trim() || null;

    const presenterImage = formData.get("presenterImage");
    if (!(presenterImage instanceof File) || presenterImage.size === 0) {
      return { ok: false, message: "Upload a presenter photo to animate." };
    }
    if (!presenterImage.type.startsWith("image/")) {
      return { ok: false, message: "The presenter photo must be an image file." };
    }
    if (presenterImage.size > MAX_PRESENTER_IMAGE_BYTES) {
      return { ok: false, message: "Presenter photo is too large — keep it under 8MB." };
    }

    await db()
      .insert(schema.ugcVideos)
      .values({
        ...values,
        mode: "avatar",
        voiceId,
        voiceName,
        presenterImageBase64: Buffer.from(await presenterImage.arrayBuffer()).toString("base64"),
        presenterImageMimeType: presenterImage.type,
        // The avatar model's audio is the voiceover, so there is nothing for
        // it to generate — stored false rather than left at the column
        // default so the row cannot be misread as having asked for both.
        generateAudio: false,
      });
  } else {
    await db()
      .insert(schema.ugcVideos)
      .values({
        ...values,
        mode: "prompt",
        generateAudio:
          model.supportsGeneratedAudio && String(formData.get("generateAudio") ?? "") === "true",
      });
  }

  revalidatePath("/ugc-videos");
  return { ok: true, message: "Generating — this can take a few minutes. Refresh to check progress." };
}

/**
 * Aspect ratio, resolution and duration, each kept only if this model
 * advertises it and the posted value is one it lists. Anything else becomes
 * null, which the worker sends as "omitted" so the model applies its own
 * default — a safer outcome than passing through a value that would fail the
 * request.
 */
function readFraming(formData: FormData, model: VideoModelSpec) {
  const aspectRatio = String(formData.get("aspectRatio") ?? "");
  const resolution = String(formData.get("resolution") ?? "");
  const durationSecs = Number(formData.get("durationSecs") ?? "");

  return {
    aspectRatio: model.aspectRatios.some((r) => r === aspectRatio) ? aspectRatio : null,
    resolution: model.resolutions.some((r) => r === resolution) ? resolution : null,
    requestedDurationSecs: model.durations.includes(durationSecs) ? durationSecs : null,
  };
}

export async function queueVideoForPosting(videoId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageUgcVideos", "queue a video for posting");
  if (refusal) return refusal;

  const [video] = await db()
    .select({ id: schema.ugcVideos.id, status: schema.ugcVideos.status })
    .from(schema.ugcVideos)
    .where(
      and(
        eq(schema.ugcVideos.id, videoId),
        eq(schema.ugcVideos.organizationId, session.workspace.organizationId),
      ),
    )
    .limit(1);
  if (!video) return { ok: false, message: "No such video." };
  if (video.status !== "ready") return { ok: false, message: "This video hasn't finished generating yet." };

  const platform = String(formData.get("platform") ?? "").trim();
  if (!platform) return { ok: false, message: "Choose a platform." };

  const caption = String(formData.get("caption") ?? "").trim() || null;
  const scheduledAtRaw = String(formData.get("scheduledAt") ?? "").trim();
  const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, message: "That schedule date isn't valid." };
  }

  await db().insert(schema.ugcVideoPostQueue).values({
    organizationId: session.workspace.organizationId,
    videoId,
    platform,
    caption,
    scheduledAt,
    status: "queued",
    createdBy: session.user.id,
  });

  revalidatePath(`/ugc-videos/${videoId}`);
  return { ok: true, message: "Queued for posting." };
}

export async function setPostQueueStatus(
  entryId: string,
  videoId: string,
  status: "posted" | "canceled",
): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageUgcVideos", "update the posting queue");
  if (refusal) return refusal;

  const [updated] = await db()
    .update(schema.ugcVideoPostQueue)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(schema.ugcVideoPostQueue.id, entryId),
        eq(schema.ugcVideoPostQueue.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ id: schema.ugcVideoPostQueue.id });
  if (!updated) return { ok: false, message: "No such queue entry." };

  revalidatePath(`/ugc-videos/${videoId}`);
  return { ok: true, message: status === "posted" ? "Marked as posted." : "Canceled." };
}
