"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Outbound webhook endpoints (`ops.webhooks`, distinct from an alert
 * channel's own webhook destination). Gated `manageProject` (admin+) —
 * a registered endpoint receives conversion data on every matching goal,
 * the same trust tier as changing what a property collects.
 */

export async function createWebhook(formData: FormData): Promise<ActionResult & { secret?: string }> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "register a webhook");
  if (refusal) return refusal;

  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return { ok: false, message: "Enter a valid URL." };

  const projectSlug = String(formData.get("project") ?? "").trim();
  const project = projectSlug ? session.projects.find((p) => p.slug === projectSlug) : undefined;
  if (projectSlug && !project) return { ok: false, message: "Unknown property." };

  const triggers = String(formData.get("triggers") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  const secret = randomBytes(32).toString("hex");

  await db()
    .insert(schema.webhooks)
    .values({
      organizationId: session.workspace.organizationId,
      projectId: project?.id ?? null,
      url,
      triggers,
      secret,
    });

  audit(db(), {
    organizationId: session.workspace.organizationId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.webhookCreated,
    targetType: "webhook",
    metadata: { url, projectId: project?.id ?? null, triggers },
  });

  revalidatePath("/settings/webhooks");
  return { ok: true, message: "Webhook registered", secret };
}

export async function deleteWebhook(id: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "delete a webhook");
  if (refusal) return refusal;

  const [deleted] = await db()
    .delete(schema.webhooks)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.organizationId, session.workspace.organizationId)))
    .returning({ id: schema.webhooks.id, url: schema.webhooks.url });
  if (!deleted) return { ok: false, message: "No such webhook." };

  audit(db(), {
    organizationId: session.workspace.organizationId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.webhookDeleted,
    targetType: "webhook",
    targetId: deleted.id,
    metadata: { url: deleted.url },
  });

  revalidatePath("/settings/webhooks");
  return { ok: true, message: "Webhook deleted" };
}

export async function toggleWebhook(id: string, active: boolean): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "change a webhook");
  if (refusal) return refusal;

  const [updated] = await db()
    .update(schema.webhooks)
    .set(active ? { active, failureCount: 0 } : { active })
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.organizationId, session.workspace.organizationId)))
    .returning({ id: schema.webhooks.id });
  if (!updated) return { ok: false, message: "No such webhook." };

  revalidatePath("/settings/webhooks");
  return { ok: true, message: active ? "Enabled" : "Disabled" };
}
