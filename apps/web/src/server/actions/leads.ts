"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireProject } from "@/server/session";
import { getHotLead } from "@/server/sales";
import { generateOutreachMessage } from "@/server/outreach";
import { AiSignalError } from "@/server/ai";
import { getAiCredentials } from "@/server/integrations";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Mutations for the "who to contact" list on the Sales signal panel.
 *
 * `hotLeads`'s "portfolio" scope (see `@/server/sales`) can surface a person
 * whose alias rows live on a different project than the one the caller
 * happens to be viewing, in the same organization. Both actions below
 * therefore verify `organizationId` only — never `projectId` — so a member
 * can act on any lead in their own org regardless of which property page
 * they opened it from, without reaching into another tenant's data.
 */

export async function markLeadContacted(
  slug: string,
  personId: string,
  contacted: boolean,
): Promise<ActionResult> {
  const { session } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "mark a lead as contacted");
  if (refusal) return refusal;

  const [updated] = await db()
    .update(schema.persons)
    .set({
      contactedAt: contacted ? new Date() : null,
      contactedBy: contacted ? session.user.id : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.persons.id, personId),
        eq(schema.persons.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ id: schema.persons.id });

  if (!updated) return { ok: false, message: "No such person." };

  revalidatePath(`/p/${slug}/signals`);
  return { ok: true, message: contacted ? "Marked as contacted" : "Marked as not contacted" };
}

export async function draftOutreachMessage(
  slug: string,
  personId: string,
  // Accepted for symmetry with `regenerateSalesSignal` and because a
  // portfolio-scope draft may one day want to say something different about
  // a lead seen on several properties — unused today since the project name
  // in the message body comes from wherever the panel is open regardless.
  scope: "project" | "portfolio",
): Promise<ActionResult & { message: string | null }> {
  void scope;
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "draft an outreach message");
  if (refusal) return { ok: false, message: refusal.message ?? "Not allowed." };

  const lead = await getHotLead(personId, session.workspace.organizationId);
  if (!lead) return { ok: false, message: "No such lead." };

  try {
    const draft = await generateOutreachMessage(
      lead,
      project.name,
      await getAiCredentials(session.workspace.organizationId, project.id),
    );
    return { ok: true, message: draft };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof AiSignalError ? error.message : "Could not draft a message.",
    };
  }
}
