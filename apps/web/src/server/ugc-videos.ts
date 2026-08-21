import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, decryptCredential, schema } from "@falorb/db";
import { ElevenLabsClient, type Voice } from "@falorb/elevenlabs-client";

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
  status: schema.ugcVideos.status,
  lastError: schema.ugcVideos.lastError,
  videoUrl: schema.ugcVideos.videoUrl,
  durationSeconds: schema.ugcVideos.durationSeconds,
  createdAt: schema.ugcVideos.createdAt,
  updatedAt: schema.ugcVideos.updatedAt,
};

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

/**
 * The org's available ElevenLabs voices, for the generation form's voice
 * picker — so avatar mode is "pick from your account's voices" rather than
 * pasting a raw voice ID by hand. Returns `[]` on no connection or any
 * failure (an expired key, a network blip) rather than throwing: the
 * generation form already refuses to submit without a connection (see
 * `createUgcVideo`), so a picker with no options here just falls back to
 * "Auto" — it never blocks page render.
 */
export async function listAvailableVoices(organizationId: string): Promise<Voice[]> {
  const [connection] = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "elevenlabs"),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  if (!connection) return [];

  try {
    const apiKey = decryptCredential({
      ciphertext: connection.encryptedApiKey,
      iv: connection.iv,
      authTag: connection.authTag,
    });
    const client = new ElevenLabsClient({ baseUrl: connection.baseUrl, apiKey });
    return await client.listVoices();
  } catch {
    return [];
  }
}
