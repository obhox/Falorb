"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { BufferApiError } from "@falorb/buffer-client";
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
 */

export interface ComposeResult extends ActionResult {
  succeededChannelIds?: string[];
  failedChannelIds?: string[];
}

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
        mode: dueAt ? undefined : "addToQueue",
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
      metadata: { channelIds: succeeded, failedChannelIds: failed, scheduled: Boolean(dueAt) },
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
  return { ok: true, message: dueAt ? "Post scheduled." : "Added to Buffer's queue." };
}
