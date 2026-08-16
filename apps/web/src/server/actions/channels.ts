"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { assertSafeWebhookUrl, UnsafeUrlError } from "@falorb/core";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Alert delivery channels.
 *
 * A rule with no channel is not an alert — the worker logs the message to its
 * own stdout and moves on, which nobody is watching. Channels are therefore
 * part of alerting rather than an advanced extra, and the alerts page refuses
 * to pretend a channel-less rule is configured.
 *
 * The config shapes here are exactly what `apps/worker/src/jobs/alerts.ts`
 * reads: `{ url }` for Slack and webhooks, `{ url, secret }` to sign a webhook,
 * `{ to }` for email.
 */

export const CHANNEL_KINDS = ["slack", "webhook", "email"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export async function createChannel(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "add a delivery channel");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Name the channel after where it goes." };

  const kind = String(formData.get("kind") ?? "slack") as ChannelKind;
  if (!(CHANNEL_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: "Unknown channel type." };
  }

  let config: Record<string, string>;

  if (kind === "email") {
    const to = String(formData.get("to") ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return { ok: false, message: "Enter the address alerts should go to." };
    }
    config = { to };
  } else {
    const raw = String(formData.get("url") ?? "").trim();

    /**
     * A scheme test is not enough here. The worker POSTs to this URL from
     * inside the compose network, where the datastores and the cloud metadata
     * endpoint are reachable and the internet is not — so `https://` alone
     * happily accepted `https://clickhouse:8123` or an attacker's host that
     * resolves to 127.0.0.1. `assertSafeWebhookUrl` screens the syntax now;
     * the worker re-screens the resolved address on every hop at send time,
     * which is what defeats a hostname repointed after it was saved.
     */
    let url: string;
    try {
      url = assertSafeWebhookUrl(raw).toString();
    } catch (error) {
      return {
        ok: false,
        message: error instanceof UnsafeUrlError ? error.message : "Enter an https:// URL for the webhook.",
      };
    }

    const secret = String(formData.get("secret") ?? "").trim();
    config = secret ? { url, secret } : { url };
  }

  await db().insert(schema.alertChannels).values({
    organizationId: session.workspace.organizationId,
    name,
    kind,
    config,
  });

  revalidatePath("/alerts");
  return { ok: true, message: "Channel added" };
}

export async function deleteChannel(channelId: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "remove a delivery channel");
  if (refusal) return refusal;

  // Rules referencing this channel have `channelId` set null by the schema's
  // ON DELETE SET NULL, which silently turns them into log-only alerts. Say so
  // rather than letting that happen invisibly.
  const [stillUsing] = await db()
    .select({ id: schema.alerts.id })
    .from(schema.alerts)
    .where(
      and(
        eq(schema.alerts.channelId, channelId),
        eq(schema.alerts.organizationId, session.workspace.organizationId),
      ),
    )
    .limit(1);

  if (stillUsing) {
    return {
      ok: false,
      message: "A rule still delivers here. Point it at another channel first.",
    };
  }

  const [deleted] = await db()
    .delete(schema.alertChannels)
    .where(
      and(
        eq(schema.alertChannels.id, channelId),
        eq(schema.alertChannels.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!deleted) return { ok: false, message: "No such channel." };

  revalidatePath("/alerts");
  return { ok: true, message: "Channel removed" };
}

/** Point an existing rule at a channel, or detach it. */
export async function setAlertChannel(
  alertId: string,
  channelId: string | null,
): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "change alert delivery");
  if (refusal) return refusal;

  if (channelId) {
    const [channel] = await db()
      .select({ id: schema.alertChannels.id })
      .from(schema.alertChannels)
      .where(
        and(
          eq(schema.alertChannels.id, channelId),
          eq(schema.alertChannels.organizationId, session.workspace.organizationId),
        ),
      )
      .limit(1);
    if (!channel) return { ok: false, message: "No such channel." };
  }

  const [updated] = await db()
    .update(schema.alerts)
    .set({ channelId })
    .where(
      and(
        eq(schema.alerts.id, alertId),
        eq(schema.alerts.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!updated) return { ok: false, message: "No such alert." };

  revalidatePath("/alerts");
  return { ok: true, message: channelId ? "Delivery updated" : "Delivery detached" };
}
