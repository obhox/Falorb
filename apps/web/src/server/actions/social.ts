"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { BufferApiError, type CreatePostMode } from "@falorb/buffer-client";
import { requireSession } from "@/server/session";
import { getBufferClient } from "@/server/integrations";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Manual post composition against Buffer — a human writes text, picks one or
 * more connected channels, and either queues it or schedules it for a
 * specific time (`dueAt`). Buffer's `createPost` mutation takes one
 * `channelId` per call, not an array (see `packages/buffer-client`), so
 * publishing to several channels means one mutation per channel here — a
 * partial failure (some channels post, others reject) is reported rather
 * than treated as an all-or-nothing transaction, since Buffer itself offers
 * no such transaction across channels.
 *
 * Nothing here runs on a schedule or without a click — same posture as
 * `crm.ts`'s manual Linki actions.
 *
 * `mode` is Falorb's intent — queue it, draft it, send it now, or schedule it
 * for `dueAt` — not Buffer's wire value: the client maps it onto whatever
 * `schedulingType`/`mode` members the live schema actually defines
 * (`packages/buffer-client/src/schema.ts`), so a Buffer enum rename doesn't
 * reach this file or the form.
 */

export interface ComposeResult extends ActionResult {
  succeededChannelIds?: string[];
  failedChannelIds?: string[];
}

const COMPOSE_MODES = ["queue", "draft", "now", "schedule"] as const;

function parseMode(raw: unknown, dueAt: string): CreatePostMode {
  const value = String(raw ?? "");
  if ((COMPOSE_MODES as readonly string[]).includes(value)) {
    // A time in the form always wins over a stale "queue" selection:
    // scheduling is what the user typed a date for.
    return value === "queue" && dueAt ? "schedule" : (value as CreatePostMode);
  }
  return dueAt ? "schedule" : "queue";
}

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

export async function composeSocialPost(formData: FormData): Promise<ComposeResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "actOnIntegrations", "publish to Buffer");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { ok: false, message: "Write something to post." };

  const channelIds = formData.getAll("channelId").map(String).filter(Boolean);
  if (!channelIds.length) return { ok: false, message: "Choose at least one channel." };

  const dueAt = String(formData.get("dueAt") ?? "").trim();
  const mode = parseMode(formData.get("mode"), dueAt);
  if (mode === "schedule" && !dueAt) {
    return { ok: false, message: "Pick a time to schedule for, or add the post to the queue instead." };
  }

  const client = await getBufferClient(orgId);
  if (!client) {
    return { ok: false, message: "Buffer isn't connected. Connect it in Settings → Integrations." };
  }

  const succeeded: string[] = [];
  const failed: string[] = [];
  let firstError: string | null = null;

  for (const channelId of channelIds) {
    try {
      const post = await client.createPost({
        channelId,
        text,
        mode,
        dueAt: dueAt || undefined,
      });

      const [channel] = await db()
        .select({ id: schema.socialChannels.id })
        .from(schema.socialChannels)
        .where(
          and(eq(schema.socialChannels.organizationId, orgId), eq(schema.socialChannels.bufferId, channelId)),
        )
        .limit(1);

      await db()
        .insert(schema.socialPosts)
        .values({
          organizationId: orgId,
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

  if (succeeded.length) {
    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.socialPostCreated,
      targetType: "social_post",
      targetId: succeeded[0],
      metadata: { channelIds: succeeded, failedChannelIds: failed, mode, scheduled: mode === "schedule" },
    });
  }

  revalidatePath("/social");

  if (!succeeded.length) {
    return { ok: false, message: `Buffer rejected the post: ${firstError}` };
  }
  if (failed.length) {
    return {
      ok: true,
      message: `Posted to ${succeeded.length} of ${channelIds.length} channels — ${failed.length} failed: ${firstError}`,
      succeededChannelIds: succeeded,
      failedChannelIds: failed,
    };
  }
  return { ok: true, message: DONE_MESSAGE[mode] };
}
