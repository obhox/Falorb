"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { FunnelStep } from "@falorb/queries";
import { requireProject } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Save/delete for the funnel builder (`@/components/FunnelBuilder`).
 *
 * The builder's own state is the source of truth — this just persists a
 * snapshot of it under a name, in the same `FunnelStep[]` shape
 * `apps/web/src/server/funnels.ts`'s `listFunnels` already reads back and
 * `packages/queries`'s `funnel()` already consumes, so nothing downstream
 * needs to know a saved funnel exists versus one just typed into the URL.
 */

export async function saveFunnel(
  slug: string,
  name: string,
  steps: FunnelStep[],
  windowHours: number,
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "save a funnel");
  if (refusal) return refusal;

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) {
    return { ok: false, message: "A funnel needs a name of 1-120 characters." };
  }
  const usable = steps.filter((s) => s.event?.trim());
  if (usable.length < 2) {
    return { ok: false, message: "A funnel needs at least two steps." };
  }

  await db().insert(schema.funnels).values({
    projectId: project.id,
    name: trimmed,
    steps: usable,
    windowHours: Math.min(Math.max(Math.round(windowHours) || 168, 1), 8760),
    createdBy: session.user.id,
  });

  revalidatePath(`/p/${slug}/funnels`);
  return { ok: true, message: "Funnel saved" };
}

export async function deleteFunnel(slug: string, id: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "delete a funnel");
  if (refusal) return refusal;

  await db()
    .delete(schema.funnels)
    .where(and(eq(schema.funnels.id, id), eq(schema.funnels.projectId, project.id)));

  revalidatePath(`/p/${slug}/funnels`);
  return { ok: true, message: "Funnel deleted" };
}
