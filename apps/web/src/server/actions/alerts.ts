"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import { ALERT_METRICS, type AlertKind, type AlertMetric } from "@/server/alerts";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Alert rule mutations.
 *
 * The condition object written here is the one the worker reads. Building it
 * from typed fields rather than accepting free-form JSON keeps a malformed
 * rule from silently never firing — a rule that looks configured but does
 * nothing is worse than no rule.
 */

export async function createAlert(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "create an alert");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Name the alert after what it protects." };

  const kind = String(formData.get("kind") ?? "threshold") as AlertKind;
  const metric = asMetric(formData.get("metric"));
  const windowMinutes = clamp(Number(formData.get("window_minutes")), 5, 10080, 60);
  const value = Number(formData.get("value"));

  const projectSlug = String(formData.get("project") ?? "");
  let projectId: number | null = null;
  if (projectSlug) {
    const project = session.projects.find((p) => p.slug === projectSlug);
    if (!project) return { ok: false, message: "No such property." };
    projectId = project.id;
  }

  let condition: Record<string, unknown>;
  switch (kind) {
    case "threshold": {
      if (!Number.isFinite(value)) {
        return { ok: false, message: "A threshold rule needs a number to compare against." };
      }
      const operator = String(formData.get("operator") ?? "lt");
      condition = {
        metric,
        operator: ["lt", "lte", "gt", "gte"].includes(operator) ? operator : "lt",
        value,
        windowMinutes,
      };
      break;
    }
    case "anomaly": {
      if (!Number.isFinite(value) || value <= 0) {
        return { ok: false, message: "An anomaly rule needs a percentage change, e.g. 40." };
      }
      const direction = String(formData.get("direction") ?? "drop");
      condition = {
        metric,
        changePercent: value,
        direction: ["drop", "rise", "either"].includes(direction) ? direction : "drop",
        windowMinutes,
        // One week back, matching the worker's default.
        compareOffsetMinutes: 10080,
      };
      break;
    }
    case "error_spike":
      condition = { windowMinutes, value: Number.isFinite(value) ? value : 25 };
      break;
    default:
      condition = { windowMinutes };
  }

  await db().insert(schema.alerts).values({
    organizationId: session.workspace.organizationId,
    projectId,
    name,
    kind,
    condition,
    cooldownMinutes: clamp(Number(formData.get("cooldown_minutes")), 5, 10080, 60),
    createdBy: session.user.id,
  });

  revalidatePath("/alerts");
  return { ok: true, message: "Alert created" };
}

export async function setAlertActive(alertId: string, active: boolean): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "change an alert");
  if (refusal) return refusal;

  const [updated] = await db()
    .update(schema.alerts)
    .set({ active })
    .where(
      and(
        eq(schema.alerts.id, alertId),
        eq(schema.alerts.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!updated) return { ok: false, message: "No such alert." };

  revalidatePath("/alerts");
  return { ok: true };
}

export async function deleteAlert(alertId: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "remove an alert");
  if (refusal) return refusal;

  const [deleted] = await db()
    .delete(schema.alerts)
    .where(
      and(
        eq(schema.alerts.id, alertId),
        eq(schema.alerts.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!deleted) return { ok: false, message: "No such alert." };

  revalidatePath("/alerts");
  return { ok: true, message: "Alert removed" };
}

function asMetric(value: FormDataEntryValue | null): AlertMetric {
  const text = String(value ?? "");
  return (ALERT_METRICS as readonly string[]).includes(text) ? (text as AlertMetric) : "visitors";
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}
