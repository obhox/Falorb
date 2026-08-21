"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireProject } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Per-project listening keyword config, edited on that property's own
 * settings tab even though the resulting prospects are consumed org-wide on
 * `/prospecting` — same split as `goals`/`referral_links`, which are
 * configured per-project despite nothing about them being portfolio-scoped.
 */

export async function addProspectKeyword(slug: string, keyword: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "add a listening keyword");
  if (refusal) return refusal;

  const trimmed = keyword.trim();
  if (!trimmed || trimmed.length > 100) {
    return { ok: false, message: "A keyword needs to be 1-100 characters." };
  }

  await db()
    .insert(schema.prospectKeywords)
    .values({ projectId: project.id, keyword: trimmed, createdBy: session.user.id })
    .onConflictDoNothing({
      target: [schema.prospectKeywords.projectId, schema.prospectKeywords.keyword],
    });

  revalidatePath(`/p/${slug}/settings`);
  return { ok: true, message: "Keyword added" };
}

export async function removeProspectKeyword(slug: string, keywordId: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "remove a listening keyword");
  if (refusal) return refusal;

  await db()
    .delete(schema.prospectKeywords)
    .where(
      and(
        eq(schema.prospectKeywords.id, keywordId),
        eq(schema.prospectKeywords.projectId, project.id),
      ),
    );

  revalidatePath(`/p/${slug}/settings`);
  return { ok: true, message: "Keyword removed" };
}

export async function toggleProspectKeyword(
  slug: string,
  keywordId: string,
  active: boolean,
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "change a listening keyword");
  if (refusal) return refusal;

  await db()
    .update(schema.prospectKeywords)
    .set({ active })
    .where(
      and(
        eq(schema.prospectKeywords.id, keywordId),
        eq(schema.prospectKeywords.projectId, project.id),
      ),
    );

  revalidatePath(`/p/${slug}/settings`);
  return { ok: true, message: active ? "Keyword enabled" : "Keyword disabled" };
}
