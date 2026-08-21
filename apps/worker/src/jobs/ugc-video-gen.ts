import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { decryptCredential, schema } from "@falorb/db";
import { complete, AiSignalError } from "@falorb/ai";
import { ElevenLabsClient, ElevenLabsApiError, LIPSYNC_MODEL_ID } from "@falorb/elevenlabs-client";
import type { WorkerContext } from "../context";

/**
 * Advances UGC videos (FEATURES.md §18) one stage per tick: script -> voice
 * -> submit for lipsync video -> poll for completion. One stage per row per
 * run, not the whole chain in one call, so a crash mid-chain resumes from
 * the last persisted stage instead of re-running (and re-billing) earlier
 * stages — same reasoning `apps/worker/src/jobs/clay-enrichment.ts` gives
 * for caching both hits and misses.
 *
 * Per-organization, like `clay-enrichment.ts`: each org connects its own
 * ElevenLabs account via `integrationConnections` (`provider: "elevenlabs"`)
 * rather than Falorb sharing one platform-wide key, so this loops connected
 * orgs and builds a client from each connection's own decrypted credential.
 *
 * Runs frequently (registered at a short interval in `index.ts`) since this
 * is user-facing: someone is on the review page waiting to see their video
 * finish.
 */

const MAX_PER_ORG_PER_RUN = 5;
/** How long a row may sit in `video_processing` before it's treated as
 * stuck rather than still rendering. */
const PROCESSING_TIMEOUT_MS = 10 * 60_000;

const SCRIPT_SYSTEM_PROMPT =
  "You write short UGC-style video ad scripts — the kind a single creator " +
  "delivers straight to camera, not a polished commercial. Given a brief " +
  "describing a product or offer, write a 15-30 second script: an opening " +
  "hook in the first line, then a natural, conversational pitch, then a " +
  "clear call to action. Write only the words the presenter says aloud — " +
  "no scene directions, no speaker labels, no stage directions in " +
  "brackets, no markdown. Keep it under 80 words so it fits a short " +
  "voiceover.";

const IN_FLIGHT_STATUSES = ["pending", "script_ready", "voice_ready", "video_processing"] as const;

type UgcVideoRow = typeof schema.ugcVideos.$inferSelect;

export async function generateUgcVideos(context: WorkerContext): Promise<number> {
  // Org-level connections only — same reasoning as `linki-sync.ts`: a
  // property's own override is used on demand, not swept by this job.
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "elevenlabs"),
        eq(schema.integrationConnections.status, "active"),
      ),
    );

  if (!connections.length) return 0;

  let advanced = 0;
  for (const connection of connections) {
    try {
      advanced += await advanceForOrg(context, connection);
    } catch (error) {
      // A decrypt failure or a constructor-level problem, not a per-video
      // one — same split `clay-enrichment.ts`'s outer catch draws.
      console.error(`[ugc-video-gen] org ${connection.organizationId} failed:`, String(error));
      await context.db
        .update(schema.integrationConnections)
        .set({ status: "error", lastError: String(error), updatedAt: new Date() })
        .where(eq(schema.integrationConnections.id, connection.id));
    }
  }

  if (advanced) console.log(`[ugc-video-gen] advanced ${advanced} video(s)`);
  return advanced;
}

async function advanceForOrg(
  context: WorkerContext,
  connection: typeof schema.integrationConnections.$inferSelect,
): Promise<number> {
  const apiKey = decryptCredential({
    ciphertext: connection.encryptedApiKey,
    iv: connection.iv,
    authTag: connection.authTag,
  });
  const client = new ElevenLabsClient({ baseUrl: connection.baseUrl, apiKey });

  const rows = await context.db
    .select()
    .from(schema.ugcVideos)
    .where(
      and(
        eq(schema.ugcVideos.organizationId, connection.organizationId),
        inArray(schema.ugcVideos.status, IN_FLIGHT_STATUSES),
      ),
    )
    .orderBy(asc(schema.ugcVideos.updatedAt))
    .limit(MAX_PER_ORG_PER_RUN);

  let advanced = 0;
  let lastError: string | null = null;

  for (const row of rows) {
    try {
      const changed = await advanceOne(context, client, row);
      if (changed) advanced++;
    } catch (error) {
      console.error(`[ugc-video-gen] video ${row.id} failed:`, String(error));
      await fail(context, row.id, String(error));
      lastError = String(error);
    }
  }

  // Connection health reflects this run, same convention
  // `clay-enrichment.ts`'s `enrichForOrg` uses — a bad/expired key surfaces
  // here even though the individual video row is what actually shows
  // "failed" to the person who generated it.
  if (rows.length) {
    await context.db
      .update(schema.integrationConnections)
      .set({
        lastSyncedAt: new Date(),
        status: lastError ? "error" : "active",
        lastError,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationConnections.id, connection.id));
  }

  return advanced;
}

async function advanceOne(
  context: WorkerContext,
  client: ElevenLabsClient,
  row: UgcVideoRow,
): Promise<boolean> {
  switch (row.status) {
    case "pending": {
      let script: string;
      try {
        script = await complete(SCRIPT_SYSTEM_PROMPT, row.brief, { maxTokens: 300 });
      } catch (error) {
        await fail(context, row.id, error instanceof AiSignalError ? error.message : String(error));
        return true;
      }
      await context.db
        .update(schema.ugcVideos)
        .set({ script, status: "script_ready", updatedAt: new Date() })
        .where(eq(schema.ugcVideos.id, row.id));
      return true;
    }

    case "script_ready": {
      if (!row.script) {
        await fail(context, row.id, "No script to voice — this row should not have reached this stage.");
        return true;
      }
      let speech: Awaited<ReturnType<ElevenLabsClient["textToSpeech"]>>;
      try {
        speech = await client.textToSpeech(row.script, row.voiceId);
      } catch (error) {
        await fail(context, row.id, describeElevenLabsError(error));
        return true;
      }
      await context.db
        .update(schema.ugcVideos)
        .set({
          audioBase64: speech.audioBase64,
          audioMimeType: speech.mimeType,
          status: "voice_ready",
          updatedAt: new Date(),
        })
        .where(eq(schema.ugcVideos.id, row.id));
      return true;
    }

    case "voice_ready": {
      if (!row.audioBase64 || !row.audioMimeType) {
        await fail(context, row.id, "No voiceover to animate — this row should not have reached this stage.");
        return true;
      }
      let submission: Awaited<ReturnType<ElevenLabsClient["createLipsyncVideo"]>>;
      try {
        submission = await client.createLipsyncVideo({
          imageBase64: row.presenterImageBase64,
          imageMimeType: row.presenterImageMimeType,
          audioBase64: row.audioBase64,
          audioMimeType: row.audioMimeType,
        });
      } catch (error) {
        await fail(context, row.id, describeElevenLabsError(error));
        return true;
      }
      await context.db
        .update(schema.ugcVideos)
        .set({
          elevenlabsGenerationId: submission.id,
          videoModel: LIPSYNC_MODEL_ID,
          status: "video_processing",
          processingStartedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.ugcVideos.id, row.id));
      return true;
    }

    case "video_processing": {
      if (!row.elevenlabsGenerationId) {
        await fail(context, row.id, "Missing ElevenLabs generation id — cannot poll for a result.");
        return true;
      }

      const stale =
        row.processingStartedAt !== null &&
        Date.now() - row.processingStartedAt.getTime() > PROCESSING_TIMEOUT_MS;

      let result: Awaited<ReturnType<ElevenLabsClient["getVideoGeneration"]>>;
      try {
        result = await client.getVideoGeneration(row.elevenlabsGenerationId);
      } catch (error) {
        if (stale) {
          await fail(context, row.id, `Timed out waiting for ElevenLabs: ${describeElevenLabsError(error)}`);
          return true;
        }
        // A transient poll failure on a not-yet-stale row is not fatal —
        // leave it in `video_processing` and try again next tick.
        return false;
      }

      if (result.status === "completed") {
        await context.db
          .update(schema.ugcVideos)
          .set({
            videoUrl: result.videoUrl,
            durationSeconds: result.durationSeconds,
            status: "ready",
            processingStartedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.ugcVideos.id, row.id));
        return true;
      }

      if (result.status === "failed") {
        await fail(context, row.id, result.error ?? "ElevenLabs reported the video generation failed.");
        return true;
      }

      if (stale) {
        await fail(context, row.id, "Timed out waiting for ElevenLabs to finish rendering the video.");
        return true;
      }

      // Still rendering, not yet stale — nothing to persist this tick.
      return false;
    }

    default:
      return false;
  }
}

async function fail(context: WorkerContext, id: string, message: string): Promise<void> {
  await context.db
    .update(schema.ugcVideos)
    .set({ status: "failed", lastError: message, processingStartedAt: null, updatedAt: new Date() })
    .where(eq(schema.ugcVideos.id, id));
}

function describeElevenLabsError(error: unknown): string {
  if (error instanceof ElevenLabsApiError) {
    return `ElevenLabs returned HTTP ${error.status}: ${JSON.stringify(error.body)}`;
  }
  return String(error);
}
