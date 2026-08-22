import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@falorb/db";
import { BufferApiError, type CreatePostMode } from "@falorb/buffer-client";
import type { McpContext } from "../context";
import { requireScope } from "../context";
import { getBufferClient } from "../clients";
import { ago, failure, table, text } from "../format";

const COMPOSE_MODES = ["queue", "draft", "now", "schedule"] as const;

const DONE_MESSAGE: Record<CreatePostMode, string> = {
  queue: "Added to Buffer's queue.",
  draft: "Saved as a draft in Buffer.",
  now: "Published through Buffer.",
  schedule: "Post scheduled.",
};

function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return new Date(value * 1000);
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && String(asNumber) === value ? new Date(asNumber * 1000) : new Date(value);
}

/**
 * Social — a read-only mirror of Buffer (social post scheduling), refreshed
 * every 15 minutes by `apps/worker/src/jobs/buffer-sync.ts`, plus two write
 * tools that reach Buffer itself: composing/publishing a post, and deleting
 * one (see FEATURES.md §13/§13b).
 *
 * `create_social_post` mirrors `apps/web/src/server/actions/social.ts`'s
 * `composeSocialPost` exactly: `mode` is Falorb's intent (queue a draft,
 * publish now, or schedule for `due_at`), not Buffer's own wire value —
 * `packages/buffer-client` maps it onto whatever the live GraphQL schema
 * actually defines. A post genuinely publishes when `mode: "now"` — this is
 * a real, public, external action, not a Falorb-internal one, so use it
 * deliberately.
 */
export function registerSocialTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_social_channels",
    {
      title: "List social channels",
      description:
        "Social accounts (channels) connected in Buffer and mirrored here — which platforms, " +
        "posting limits, and whether a channel has stopped syncing.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.socialChannels)
          .where(eq(schema.socialChannels.organizationId, scope.organizationId))
          .orderBy(desc(schema.socialChannels.syncedAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Service", get: (r) => r.service },
              { header: "Name", get: (r) => r.displayName ?? r.name },
              { header: "Weekly limit", get: (r) => r.weeklyPostingLimit },
              { header: "Queue paused", get: (r) => (r.isQueuePaused ? "yes" : "no") },
              { header: "Status", get: (r) => (r.isDisconnected ? "disconnected" : "connected") },
              { header: "Synced", get: (r) => ago(r.syncedAt.toISOString()) },
            ],
            "No social channels mirrored yet — Buffer may not be connected, or has never synced.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_social_posts",
    {
      title: "List social posts",
      description:
        "Scheduled and sent posts mirrored from Buffer, most recently due/sent first. Optionally " +
        "filtered to one channel.",
      inputSchema: {
        channel_id: z.string().optional().describe("From list_social_channels. Omit for every channel."),
        status: z.string().optional().describe('Buffer\'s status string, e.g. "sent", "due", "failed".'),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ channel_id, status, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.socialPosts.organizationId, scope.organizationId)];
        if (channel_id) conditions.push(eq(schema.socialPosts.channelId, channel_id));
        if (status) conditions.push(eq(schema.socialPosts.status, status));

        const rows = await db
          .select()
          .from(schema.socialPosts)
          .where(and(...conditions))
          .orderBy(desc(schema.socialPosts.dueAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Text", get: (r) => r.text },
              { header: "Status", get: (r) => r.status },
              { header: "Due", get: (r) => (r.dueAt ? ago(r.dueAt.toISOString()) : "—") },
              { header: "Sent", get: (r) => (r.sentAt ? ago(r.sentAt.toISOString()) : "—") },
              { header: "Error", get: (r) => r.errorMessage },
            ],
            "No posts mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_social_post",
    {
      title: "Compose a Buffer post",
      description:
        "Write and queue, draft, schedule, or immediately publish a post to one or more connected " +
        "Buffer channels. `mode: \"now\"` publishes for real, to a real public account — this reaches " +
        "outside Falorb. One mutation per channel; a partial failure (some channels post, others " +
        "reject) is reported rather than treated as all-or-nothing. Requires the write scope.",
      inputSchema: {
        text: z.string().min(1).describe("The post body."),
        channel_ids: z.array(z.string()).min(1).describe("Buffer channel ids, from list_social_channels."),
        mode: z.enum(COMPOSE_MODES).default("queue").describe(
          "\"queue\": Buffer's normal queue. \"draft\": save without scheduling. \"now\": publish immediately, for real. \"schedule\": needs due_at.",
        ),
        due_at: z.string().optional().describe("ISO timestamp to schedule for. Required when mode is \"schedule\"."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ text: body, channel_ids, mode, due_at }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        if (mode === "schedule" && !due_at) {
          return failure('due_at is required when mode is "schedule".');
        }

        const client = await getBufferClient(db, scope.organizationId);
        if (!client) return failure("Buffer isn't connected. Connect it in Settings → Integrations.");

        const succeeded: string[] = [];
        const failed: string[] = [];
        let firstError: string | null = null;

        for (const channelId of channel_ids) {
          try {
            const post = await client.createPost({
              channelId,
              text: body,
              mode,
              dueAt: due_at || undefined,
            });

            const [channel] = await db
              .select({ id: schema.socialChannels.id })
              .from(schema.socialChannels)
              .where(
                and(
                  eq(schema.socialChannels.organizationId, scope.organizationId),
                  eq(schema.socialChannels.bufferId, channelId),
                ),
              )
              .limit(1);

            await db
              .insert(schema.socialPosts)
              .values({
                organizationId: scope.organizationId,
                bufferId: post.id,
                channelBufferId: channelId,
                channelId: channel?.id ?? null,
                text: post.text,
                status: post.status,
                shareMode: post.shareMode,
                schedulingType: post.schedulingType,
                dueAt: toDate(post.dueAt),
                sentAt: toDate(post.sentAt),
                errorMessage: post.errorMessage ?? null,
              })
              .onConflictDoUpdate({
                target: [schema.socialPosts.organizationId, schema.socialPosts.bufferId],
                set: { text: post.text, status: post.status, syncedAt: new Date() },
              });

            succeeded.push(channelId);
          } catch (error) {
            failed.push(channelId);
            firstError = error instanceof BufferApiError ? error.message : String(error);
          }
        }

        if (!succeeded.length) return failure(`Buffer rejected the post: ${firstError}`);
        if (failed.length) {
          return text(
            `Posted to ${succeeded.length} of ${channel_ids.length} channels — ${failed.length} failed: ${firstError}`,
          );
        }
        return text(DONE_MESSAGE[mode]);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "delete_social_post",
    {
      title: "Delete a Buffer post",
      description:
        "Delete a queued, drafted, or scheduled post from Buffer. A post that has already sent " +
        "cannot be un-sent — this only removes something not yet published. Requires the write scope.",
      inputSchema: { post_id: z.string().describe("Buffer's post id, from list_social_posts.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ post_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const client = await getBufferClient(db, scope.organizationId);
        if (!client) return failure("Buffer isn't connected. Connect it in Settings → Integrations.");

        try {
          await client.deletePost(post_id);
        } catch (error) {
          return failure(`Buffer rejected the delete: ${error instanceof BufferApiError ? error.message : String(error)}`);
        }

        await db
          .delete(schema.socialPosts)
          .where(and(eq(schema.socialPosts.organizationId, scope.organizationId), eq(schema.socialPosts.bufferId, post_id)));

        return text("Deleted.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
