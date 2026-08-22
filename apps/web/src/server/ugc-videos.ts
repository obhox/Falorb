import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { ElevenLabsVoice } from "@falorb/elevenlabs-client";
import { getElevenLabsClient } from "./integrations";

/**
 * Read helpers for the org-wide `/ugc-videos` pages (FEATURES.md §18).
 *
 * List/detail queries deliberately never select `audioBase64` or
 * `presenterImageBase64` — those exist only for the worker job to chain
 * ElevenLabs calls and have no reason to round-trip to a browser. The
 * finished video is served straight from `videoUrl` (ElevenLabs' own CDN),
 * not proxied through Falorb.
 */

export interface UgcVideoRow {
  id: string;
  projectId: number | null;
  mode: string;
  brief: string;
  script: string | null;
  videoPrompt: string | null;
  voiceName: string | null;
  voiceProvider: string;
  videoModel: string;
  aspectRatio: string | null;
  resolution: string | null;
  requestedDurationSecs: number | null;
  generateAudio: boolean;
  status: string;
  lastError: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const listColumns = {
  id: schema.ugcVideos.id,
  projectId: schema.ugcVideos.projectId,
  mode: schema.ugcVideos.mode,
  brief: schema.ugcVideos.brief,
  script: schema.ugcVideos.script,
  videoPrompt: schema.ugcVideos.videoPrompt,
  voiceName: schema.ugcVideos.voiceName,
  voiceProvider: schema.ugcVideos.voiceProvider,
  videoModel: schema.ugcVideos.videoModel,
  aspectRatio: schema.ugcVideos.aspectRatio,
  resolution: schema.ugcVideos.resolution,
  requestedDurationSecs: schema.ugcVideos.requestedDurationSecs,
  generateAudio: schema.ugcVideos.generateAudio,
  status: schema.ugcVideos.status,
  lastError: schema.ugcVideos.lastError,
  videoUrl: schema.ugcVideos.videoUrl,
  durationSeconds: schema.ugcVideos.durationSeconds,
  createdAt: schema.ugcVideos.createdAt,
  updatedAt: schema.ugcVideos.updatedAt,
};

/**
 * The org's ElevenLabs voice library, for the composer's voice picker.
 *
 * Never throws, and never blocks the page on ElevenLabs being up: a failure
 * comes back as `{ voices: [], error }` and the composer falls back to a
 * manual voice-ID field. A video is generated from a voice *id*, so someone
 * who knows theirs is not stopped by a picker that could not populate — the
 * picker exists to save them looking it up, not to be the only way in.
 *
 * Not cached. A voice cloned or renamed in ElevenLabs a minute ago should
 * appear on the next page load, and this is one small request on an
 * already `force-dynamic` page.
 */
export async function listVoiceLibrary(
  organizationId: string,
): Promise<{ voices: ElevenLabsVoice[]; error: string | null }> {
  const client = await getElevenLabsClient(organizationId);
  if (!client) return { voices: [], error: null };

  try {
    return { voices: await client.listVoices(), error: null };
  } catch (error) {
    console.error(`[ugc-videos] voice library for org ${organizationId} failed:`, String(error));
    return {
      voices: [],
      error: "Could not reach ElevenLabs to load your voices. Enter a voice ID by hand, or try again.",
    };
  }
}

export async function listUgcVideos(organizationId: string, limit = 50): Promise<UgcVideoRow[]> {
  return db()
    .select(listColumns)
    .from(schema.ugcVideos)
    .where(eq(schema.ugcVideos.organizationId, organizationId))
    .orderBy(desc(schema.ugcVideos.createdAt))
    .limit(limit);
}

export async function getUgcVideo(id: string, organizationId: string): Promise<UgcVideoRow | null> {
  const [row] = await db()
    .select(listColumns)
    .from(schema.ugcVideos)
    .where(and(eq(schema.ugcVideos.id, id), eq(schema.ugcVideos.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listPostQueue(videoId: string, organizationId: string) {
  return db()
    .select()
    .from(schema.ugcVideoPostQueue)
    .where(
      and(
        eq(schema.ugcVideoPostQueue.videoId, videoId),
        eq(schema.ugcVideoPostQueue.organizationId, organizationId),
      ),
    )
    .orderBy(desc(schema.ugcVideoPostQueue.createdAt));
}
