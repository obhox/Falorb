"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { PropertyResearchError, researchProperty } from "@falorb/research";
import { requireSession } from "@/server/session";
import { AiSignalError } from "@/server/ai";
import { getResearchClients } from "@/server/integrations";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * One-click counterpart to `property-profiler.ts`'s sweep — the same
 * "Research this company"/"Refresh from web" shape `company-research.ts`'s
 * `enrichCompany` action already established, just for what the property
 * itself is rather than a lead's employer. Manual, explicit, `member`+
 * gated, same posture as every other AI-backed write in this app.
 */
export async function recrawlProperty(slug: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "writeAnalysis", "re-crawl this property");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [project] = await db()
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.slug, slug), eq(schema.projects.organizationId, orgId)))
    .limit(1);
  if (!project) return { ok: false, message: "No such property." };

  const domain = project.domains[0];
  if (!domain) {
    return { ok: false, message: "Add a domain to this property first — there's nothing to crawl yet." };
  }

  try {
    const clients = await getResearchClients(orgId);
    const result = await researchProperty(clients, project.name, domain);

    await db()
      .update(schema.projects)
      .set({
        profileSummary: result.summary,
        profileIcp: result.icp,
        profileKeyFeatures: result.keyFeatures,
        profileSuggestedKeywords: result.suggestedKeywords,
        profileRaw: { ...result },
        profileCrawledAt: new Date(),
        profileCrawlFailedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, project.id));

    if (!result.summary && !result.icp && !result.keyFeatures.length && !result.suggestedKeywords.length) {
      return { ok: false, message: `Crawled ${domain}, but the homepage didn't state enough to build a profile from.` };
    }
  } catch (error) {
    const message =
      error instanceof PropertyResearchError || error instanceof AiSignalError
        ? error.message
        : "Could not crawl this property.";
    return { ok: false, message };
  }

  revalidatePath(`/p/${slug}/settings`);
  return { ok: true, message: "Property profile updated from web research." };
}
