"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/** Save/delete for the `/insights` cross-project builder. See
 * `apps/web/src/server/insights.ts` for what gets persisted and why. */

export async function saveInsight(
  name: string,
  query: { metric: string; dimension: string; projectSlugs: string[] },
  chart: string,
): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "save an insight");
  if (refusal) return refusal;

  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 120) {
    return { ok: false, message: "An insight needs a name of 1-120 characters." };
  }

  await db()
    .insert(schema.insights)
    .values({
      organizationId: session.workspace.organizationId,
      projectId: null,
      name: trimmed,
      kind: "breakdown",
      query,
      visualization: { chart },
      createdBy: session.user.id,
    });

  revalidatePath("/insights");
  return { ok: true, message: "Insight saved" };
}

export async function deleteInsight(id: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "delete an insight");
  if (refusal) return refusal;

  await db()
    .delete(schema.insights)
    .where(and(eq(schema.insights.id, id), eq(schema.insights.organizationId, session.workspace.organizationId)));

  revalidatePath("/insights");
  return { ok: true, message: "Insight deleted" };
}
