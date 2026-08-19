"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import { deny } from "./guard";
import type { ActionResult } from "./project";

/**
 * Organization-level settings that do not belong on a single project — right
 * now, just the weekly digest opt-out. Scoped to the caller's own
 * organization the same way `updateProjectSettings` scopes to their own
 * project: the WHERE clause is the check, so there is no window between
 * verifying access and writing.
 */

export async function updateWeeklyDigest(enabled: boolean): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "change the weekly digest setting");
  if (refusal) return refusal;

  await db()
    .update(schema.organizations)
    .set({ weeklyDigestEnabled: enabled, updatedAt: new Date() })
    .where(eq(schema.organizations.id, session.workspace.organizationId));

  revalidatePath("/settings");
  return { ok: true, message: enabled ? "Weekly digest turned on" : "Weekly digest turned off" };
}
