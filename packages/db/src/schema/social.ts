import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";

/**
 * Read-mostly mirror of Buffer (social post scheduling/publishing), pulled by
 * `apps/worker/src/jobs/buffer-sync.ts`, plus the one write path — composing
 * a post from Falorb — in `apps/web/src/server/actions/social.ts`.
 *
 * Unlike `crm.ts`/`support.ts`, there is no `personId` backfill anywhere in
 * this file: scheduled/sent social posts aren't naturally scoped to one
 * analytics person the way a CRM contact or support conversation is.
 *
 * `socialPosts.channelId` is a local FK to `socialChannels`, resolved by
 * `resolveChannelForPosts` in the sync job once both sides exist for an org —
 * same two-pass upsert-then-backfill pattern as `crmRunProfiles.runId` in
 * `crm.ts`.
 */

const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const socialChannels = pgTable(
  "social_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    bufferId: text("buffer_id").notNull(),
    /** Buffer organization the channel belongs to — a Buffer account can hold several, and `channels` is scoped to one. */
    bufferOrganizationId: text("buffer_organization_id"),
    service: text("service"),
    name: text("name"),
    displayName: text("display_name"),
    avatar: text("avatar"),
    timezone: text("timezone"),
    isDisconnected: boolean("is_disconnected").notNull().default(false),
    isQueuePaused: boolean("is_queue_paused").notNull().default(false),
    weeklyPostingLimit: integer("weekly_posting_limit"),
    /**
     * Buffer's `weeklyPostingLimit` is an object (`WeeklyPostingLimit`), not
     * the `Int` its docs imply — `weekly_posting_limit` above keeps the
     * flattened cap and this keeps the object it came from, so a rename of an
     * inner field costs the number, not the data. See `packages/buffer-client/src/normalize.ts`.
     */
    weeklyPostingLimitDetail: jsonb("weekly_posting_limit_detail").$type<Record<string, unknown>>(),
    /** The channel's queue slots (`{ days, times }` per Buffer's docs), stored as returned. */
    postingSchedule: jsonb("posting_schedule").$type<unknown>(),
    postingGoal: jsonb("posting_goal").$type<Record<string, unknown>>(),
    /** What this key may do with the channel in Buffer, e.g. whether it can publish at all. */
    allowedActions: jsonb("allowed_actions").$type<string[]>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("social_channels_org_buffer_uq").on(t.organizationId, t.bufferId)],
);

export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    bufferId: text("buffer_id").notNull(),
    channelBufferId: text("channel_buffer_id").notNull(),
    channelId: uuid("channel_id").references(() => socialChannels.id, { onDelete: "set null" }),
    text: text("text"),
    status: text("status"),
    shareMode: text("share_mode"),
    schedulingType: text("scheduling_type"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    tags: jsonb("tags").$type<string[]>(),
    metrics: jsonb("metrics").$type<Record<string, unknown>[]>(),
    metricsUpdatedAt: timestamp("metrics_updated_at", { withTimezone: true }),
    /** Buffer's own failure text for a post it couldn't publish — the reason a `failed` row is failed. */
    errorMessage: text("error_message"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_posts_org_buffer_uq").on(t.organizationId, t.bufferId),
    index("social_posts_channel_idx").on(t.channelId),
  ],
);
