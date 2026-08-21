import { and, eq, sql } from "drizzle-orm";
import { decryptCredential, schema } from "@falorb/db";
import { BufferClient, type BufferChannel, type BufferPost } from "@falorb/buffer-client";
import type { WorkerContext } from "../context";

/**
 * Mirrors Buffer (social post scheduling/publishing) into Falorb's own
 * Postgres, per org.
 *
 * Same overall shape as `linki-sync.ts`/`bund-ai-sync.ts` — a full poll every
 * run (Buffer has no incremental event stream Falorb consumes), upsert on
 * `(organizationId, bufferId)`, one try/catch per connection so one org's
 * failure doesn't abort the rest. The one structural difference:
 * `BufferClient.listPosts` cursor-walks Buffer's Relay-style pagination
 * internally rather than this job driving `limit`/`offset` pages itself, so
 * there's no local `paginateAll` helper here.
 */

export async function syncBuffer(context: WorkerContext): Promise<void> {
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.provider, "buffer"),
        eq(schema.integrationConnections.status, "active"),
      ),
    );

  for (const connection of connections) {
    try {
      await syncOrg(context, connection);
    } catch (error) {
      console.error(`[buffer-sync] org ${connection.organizationId} failed:`, String(error));
      await context.db
        .update(schema.integrationConnections)
        .set({ status: "error", lastError: String(error), updatedAt: new Date() })
        .where(eq(schema.integrationConnections.id, connection.id));
    }
  }
}

async function syncOrg(
  context: WorkerContext,
  connection: typeof schema.integrationConnections.$inferSelect,
): Promise<void> {
  const orgId = connection.organizationId;
  const apiKey = decryptCredential({
    ciphertext: connection.encryptedApiKey,
    iv: connection.iv,
    authTag: connection.authTag,
  });
  const client = new BufferClient({ baseUrl: connection.baseUrl, apiKey });

  const channels = await client.listChannels();
  await upsertChannels(context, orgId, channels);

  const posts: BufferPost[] = [];
  for (const channel of channels) {
    posts.push(...(await client.listPosts({ channelId: channel.id })));
  }
  await upsertPosts(context, orgId, posts);

  await context.db
    .update(schema.integrationConnections)
    .set({ lastSyncedAt: new Date(), status: "active", lastError: null, updatedAt: new Date() })
    .where(eq(schema.integrationConnections.id, connection.id));

  console.log(`[buffer-sync] org ${orgId}: ${channels.length} channels, ${posts.length} posts`);
}

/**
 * Buffer's DateTime serialization (ISO string vs. Unix seconds) is not
 * confirmed against a live response — handles both rather than guessing one
 * and silently mis-parsing the other.
 */
function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return new Date(value * 1000);
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && String(asNumber) === value ? new Date(asNumber * 1000) : new Date(value);
}

async function upsertChannels(context: WorkerContext, orgId: string, rows: BufferChannel[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.socialChannels)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        bufferId: r.id,
        service: r.service,
        name: r.name,
        displayName: r.displayName,
        avatar: r.avatar,
        timezone: r.timezone,
        isDisconnected: Boolean(r.isDisconnected),
        isQueuePaused: Boolean(r.isQueuePaused),
        weeklyPostingLimit: r.weeklyPostingLimit ?? null,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.socialChannels.organizationId, schema.socialChannels.bufferId],
      set: {
        service: sql`excluded.service`,
        name: sql`excluded.name`,
        displayName: sql`excluded.display_name`,
        avatar: sql`excluded.avatar`,
        timezone: sql`excluded.timezone`,
        isDisconnected: sql`excluded.is_disconnected`,
        isQueuePaused: sql`excluded.is_queue_paused`,
        weeklyPostingLimit: sql`excluded.weekly_posting_limit`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

async function upsertPosts(context: WorkerContext, orgId: string, rows: BufferPost[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.socialPosts)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        bufferId: r.id,
        channelBufferId: r.channelId,
        text: r.text,
        status: r.status,
        shareMode: r.shareMode,
        schedulingType: r.schedulingType,
        dueAt: toDate(r.dueAt),
        sentAt: toDate(r.sentAt),
        tags: r.tags ?? null,
        metrics: r.metrics ?? null,
        metricsUpdatedAt: toDate(r.metricsUpdatedAt),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.socialPosts.organizationId, schema.socialPosts.bufferId],
      set: {
        text: sql`excluded.text`,
        status: sql`excluded.status`,
        shareMode: sql`excluded.share_mode`,
        schedulingType: sql`excluded.scheduling_type`,
        dueAt: sql`excluded.due_at`,
        sentAt: sql`excluded.sent_at`,
        tags: sql`excluded.tags`,
        metrics: sql`excluded.metrics`,
        metricsUpdatedAt: sql`excluded.metrics_updated_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await resolveChannelForPosts(context, orgId);
}

/** Resolves `socialPosts.channelId` now that both sides exist — same reasoning as `linkContactsToPersons` in `linki-sync.ts`. */
async function resolveChannelForPosts(context: WorkerContext, orgId: string): Promise<void> {
  await context.db.execute(sql`
    UPDATE social_posts p SET channel_id = c.id
    FROM social_channels c
    WHERE p.organization_id = ${orgId} AND c.organization_id = ${orgId} AND p.channel_buffer_id = c.buffer_id AND p.channel_id IS NULL
  `);
}
