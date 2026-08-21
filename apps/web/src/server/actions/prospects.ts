"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import { getProspect } from "@/server/prospects";
import { generateProspectOutreachMessage } from "@/server/outreach";
import { AiSignalError } from "@/server/ai";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Mutations for the org-wide `/prospecting` page. Scoped by `organizationId`
 * only, same reasoning as `leads.ts`'s actions: a prospect's `projectId` says
 * which keyword list surfaced it, not which page someone should have to be
 * standing on to act on it.
 */

export async function markProspectContacted(
  prospectId: string,
  contacted: boolean,
): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "mark a prospect as contacted");
  if (refusal) return refusal;

  const [updated] = await db()
    .update(schema.prospects)
    .set({
      status: contacted ? "contacted" : "enriched",
      contactedAt: contacted ? new Date() : null,
      contactedBy: contacted ? session.user.id : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.prospects.id, prospectId),
        eq(schema.prospects.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ id: schema.prospects.id });

  if (!updated) return { ok: false, message: "No such prospect." };

  revalidatePath("/prospecting");
  return { ok: true, message: contacted ? "Marked as contacted" : "Marked as not contacted" };
}

export async function dismissProspect(prospectId: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "dismiss a prospect");
  if (refusal) return refusal;

  const [updated] = await db()
    .update(schema.prospects)
    .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.prospects.id, prospectId),
        eq(schema.prospects.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ id: schema.prospects.id });

  if (!updated) return { ok: false, message: "No such prospect." };

  revalidatePath("/prospecting");
  return { ok: true, message: "Dismissed" };
}

export async function draftProspectOutreach(
  prospectId: string,
): Promise<ActionResult & { message: string | null }> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "writeAnalysis", "draft an outreach message");
  if (refusal) return { ok: false, message: refusal.message ?? "Not allowed." };

  const prospect = await getProspect(prospectId, session.workspace.organizationId);
  if (!prospect) return { ok: false, message: "No such prospect." };

  const project = session.projects.find((p) => p.id === prospect.projectId);

  try {
    const draft = await generateProspectOutreachMessage(
      {
        handle: prospect.authorHandle,
        source: prospect.source,
        sourceType: prospect.sourceType,
        title: prospect.title,
        excerpt: prospect.excerpt,
        matchedKeywords: prospect.matchedKeywords,
        postedAt: prospect.postedAt?.toISOString() ?? null,
        contactName: prospect.contactName,
        contactTitle: prospect.contactTitle,
        contactCompanyDomain: prospect.contactCompanyDomain,
      },
      project?.name ?? session.workspace.organizationName,
      project?.profileSummary ?? null,
    );
    return { ok: true, message: draft };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof AiSignalError ? error.message : "Could not draft a message.",
    };
  }
}
