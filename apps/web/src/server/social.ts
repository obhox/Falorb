import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { markSyncRequested } from "./sync-demand";

/**
 * The Buffer social mirror, read-side. Written by
 * `apps/worker/src/jobs/buffer-sync.ts`; this file only reads it. A read
 * also flags the org for a fresh sync (see `sync-demand.ts`) — that sync
 * happens on the worker's next tick, not before this read returns, so the
 * page still serves whatever's already cached.
 */

export type SocialChannelRow = typeof schema.socialChannels.$inferSelect;
export type SocialPostRow = typeof schema.socialPosts.$inferSelect;

export async function listChannels(organizationId: string): Promise<SocialChannelRow[]> {
  await markSyncRequested(organizationId, "buffer");
  return db()
    .select()
    .from(schema.socialChannels)
    .where(eq(schema.socialChannels.organizationId, organizationId))
    .orderBy(desc(schema.socialChannels.syncedAt))
    .limit(50);
}

export async function listPosts(organizationId: string): Promise<SocialPostRow[]> {
  await markSyncRequested(organizationId, "buffer");
  return db()
    .select()
    .from(schema.socialPosts)
    .where(eq(schema.socialPosts.organizationId, organizationId))
    .orderBy(desc(schema.socialPosts.syncedAt))
    .limit(200);
}

/** Org-level connection only — a property-only override doesn't light up this org-wide "Buffer connected" check; see `packages/db/src/schema/integrations.ts`. */
export async function isBufferConnected(organizationId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.integrationConnections.id })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "buffer"),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
