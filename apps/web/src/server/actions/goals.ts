"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireProject } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Goal mutations.
 *
 * The project is resolved through `requireProject`, which matches the slug
 * against the session's own project list — so a goal can only ever be attached
 * to a property the caller already owns.
 */

export async function createGoal(slug: string, formData: FormData): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "create a goal");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  const matcher = String(formData.get("matcher") ?? "").trim();
  const kind = formData.get("kind") === "path" ? "path" : "event";
  const rawValue = String(formData.get("value") ?? "").trim();

  if (!name) return { ok: false, message: "Give the goal a name — what it means, not what it matches." };
  if (!matcher) {
    return {
      ok: false,
      message:
        kind === "path"
          ? "Enter a path to match, optionally ending in * for a prefix."
          : "Enter the event name the tracker sends on conversion.",
    };
  }

  let value: string | null = null;
  if (rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, message: "Value is a number of currency units, or blank." };
    }
    value = parsed.toFixed(4);
  }

  await db().insert(schema.goals).values({
    projectId: project.id,
    name,
    kind,
    matcher,
    value,
  });

  revalidatePath(`/p/${slug}/goals`);
  return { ok: true, message: "Goal created" };
}

export async function deleteGoal(slug: string, goalId: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "remove a goal");
  if (refusal) return refusal;

  const [deleted] = await db()
    .delete(schema.goals)
    // Scoped by project as well as id, so a goal id from another property
    // matches nothing rather than being deleted.
    .where(and(eq(schema.goals.id, goalId), eq(schema.goals.projectId, project.id)))
    .returning();

  if (!deleted) return { ok: false, message: "No such goal." };

  revalidatePath(`/p/${slug}/goals`);
  return { ok: true, message: "Goal removed" };
}

export async function toggleGoal(
  slug: string,
  goalId: string,
  active: boolean,
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "change a goal");
  if (refusal) return refusal;

  const [updated] = await db()
    .update(schema.goals)
    .set({ active })
    .where(and(eq(schema.goals.id, goalId), eq(schema.goals.projectId, project.id)))
    .returning();

  if (!updated) return { ok: false, message: "No such goal." };

  revalidatePath(`/p/${slug}/goals`);
  return { ok: true };
}
