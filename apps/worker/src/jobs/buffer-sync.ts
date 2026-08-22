import { and, eq, isNull, sql } from "drizzle-orm";
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
 *
 * Two Buffer-specific wrinkles the client hides from this file: a Buffer
 * account can own several Buffer *organizations* and `channels` is scoped to
 * one, so `listChannels()` walks them and merges; and every selection set is
 * built from the live schema, so a field Buffer has renamed or promoted to an
 * object type (`weeklyPostingLimit` was the one that broke the first version)
 * degrades to null here instead of failing the sync.
 */

export async function syncBuffer(context: WorkerContext): Promise<void> {
  // Org-level connections only. `socialChannels`/`socialPosts` are keyed by
  // `organizationId` alone, with no property scope to mirror a property's
  // own Buffer override into — that override is only ever read on demand
  // (see `packages/db/src/schema/integrations.ts`).
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        isNull(schema.integrationConnections.projectId),
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
  await forgetVanishedChannels(context, orgId, channels);

  const posts: BufferPost[] = [];
  for (const channel of channels) {
    try {
      // `listChannels()` walks every organization the account belongs to and
      // tags each channel with the org it actually lives in. `posts` is
      // scoped per-organization too, so it must be queried with *that*
      // channel's org, not whichever org happens to be first — otherwise
      // Buffer correctly rejects the mismatch as FORBIDDEN.
      posts.push(
        ...(await client.listPosts({ channelId: channel.id, organizationId: channel.organizationId ?? undefined })),
      );
    } catch (error) {
      // `channels` and `posts` enforce access separately — a channel the key
      // can list is not always one it can list posts for (Buffer's team-plan
      // per-channel permissions). One forbidden channel shouldn't cost the
      // org every other channel's posts.
      console.error(`[buffer-sync] org ${orgId} channel ${channel.id} posts failed:`, String(error));
    }
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
        weeklyPostingLimitDetail: r.weeklyPostingLimitDetail ?? null,
        postingSchedule: r.postingSchedule ?? null,
        postingGoal: r.postingGoal ?? null,
        allowedActions: r.allowedActions ?? null,
        bufferOrganizationId: r.organizationId ?? null,
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
        weeklyPostingLimitDetail: sql`excluded.weekly_posting_limit_detail`,
        postingSchedule: sql`excluded.posting_schedule`,
        postingGoal: sql`excluded.posting_goal`,
        allowedActions: sql`excluded.allowed_actions`,
        bufferOrganizationId: sql`excluded.buffer_organization_id`,
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
        errorMessage: r.errorMessage ?? null,
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
        errorMessage: sql`excluded.error_message`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await resolveChannelForPosts(context, orgId);
}

/**
 * A channel disconnected inside Buffer stops coming back from `channels`
 * entirely, so a mirror that only ever upserts keeps offering it in the
 * compose picker forever. Flag the ones this poll didn't see as disconnected
 * rather than deleting them — their posts still reference the row.
 */
async function forgetVanishedChannels(
  context: WorkerContext,
  orgId: string,
  seen: BufferChannel[],
): Promise<void> {
  // An empty poll is ambiguous — a key that lost access looks exactly like an
  // account with no channels — so leave the mirror alone rather than marking
  // everything disconnected on one bad answer.
  if (!seen.length) return;
  const ids = sql.join(
    seen.map((channel) => sql`${channel.id}`),
    sql`, `,
  );
  await context.db.execute(sql`
    UPDATE social_channels
    SET is_disconnected = true
    WHERE organization_id = ${orgId} AND is_disconnected = false AND buffer_id NOT IN (${ids})
  `);
}

/** Resolves `socialPosts.channelId` now that both sides exist — same reasoning as `linkContactsToPersons` in `linki-sync.ts`. */
async function resolveChannelForPosts(context: WorkerContext, orgId: string): Promise<void> {
  await context.db.execute(sql`
    UPDATE social_posts p SET channel_id = c.id
    FROM social_channels c
    WHERE p.organization_id = ${orgId} AND c.organization_id = ${orgId} AND p.channel_buffer_id = c.buffer_id AND p.channel_id IS NULL
  `);
}
