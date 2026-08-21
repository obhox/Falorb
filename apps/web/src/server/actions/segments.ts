"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { Filter } from "@falorb/queries";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Save/rename/delete for saved segments. The condition-tree builder
 * (`@/components/ConditionTreeBuilder`) is the only producer of a `Filter[]`
 * — this just persists it under a name, in the exact `{ filters }` shape
 * `apps/worker/src/jobs/rollups.ts`'s `refreshSegmentCounts` already expects.
 */

export async function saveSegment(
  name: string,
  filters: Filter[],
  projectId: number | null,
): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "save a segment");
  if (refusal) return refusal;

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) {
    return { ok: false, message: "A segment needs a name of 1-120 characters." };
  }
  if (!filters.length) {
    return { ok: false, message: "Add at least one condition." };
  }

  if (projectId !== null) {
    const [project] = await db()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.organizationId, session.workspace.organizationId)))
      .limit(1);
    if (!project) return { ok: false, message: "No such property." };
  }

  await db()
    .insert(schema.segments)
    .values({
      organizationId: session.workspace.organizationId,
      projectId,
      name: trimmed,
      definition: { filters },
      createdBy: session.user.id,
    });

  revalidatePath("/segments");
  return { ok: true, message: "Segment saved" };
}

export async function renameSegment(id: string, name: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "rename a segment");
  if (refusal) return refusal;

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) {
    return { ok: false, message: "A segment needs a name of 1-120 characters." };
  }

  await db()
    .update(schema.segments)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(schema.segments.id, id), eq(schema.segments.organizationId, session.workspace.organizationId)));

  revalidatePath("/segments");
  return { ok: true, message: "Segment renamed" };
}

export async function deleteSegment(id: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "delete a segment");
  if (refusal) return refusal;

  await db()
    .delete(schema.segments)
    .where(and(eq(schema.segments.id, id), eq(schema.segments.organizationId, session.workspace.organizationId)));

  revalidatePath("/segments");
  return { ok: true, message: "Segment deleted" };
}
