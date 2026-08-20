"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import { AiSignalError } from "@/server/ai";
import { CompanyResearchError, researchCompany } from "@/server/company-research";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/** ASN-keyed placeholder rows (`as12345`, from `apps/worker/src/jobs/enrichment.ts`) carry no real domain to research. */
function hasRealDomain(domain: string): boolean {
  return !/^as\d+$/i.test(domain);
}

/**
 * Fills in the richer `companies` fields (industry, employee range,
 * LinkedIn) the automatic ASN-based enrichment job never populates — see
 * `researchCompany`'s doc comment for why. One click, one company, using
 * its own website plus a web search — the same manual, explicit, `member`+
 * gated shape as every other AI-backed write in this app (content drafts,
 * outreach drafts), not an automated bulk job.
 */
export async function enrichCompany(personId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "writeAnalysis", "research this company");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [person] = await db()
    .select({ companyId: schema.persons.companyId })
    .from(schema.persons)
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!person?.companyId) return { ok: false, message: "No company resolved for this person yet." };

  const [company] = await db()
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.id, person.companyId))
    .limit(1);
  if (!company) return { ok: false, message: "No company resolved for this person yet." };
  if (!hasRealDomain(company.domain)) {
    return { ok: false, message: "This company has no real domain yet — only a network identifier." };
  }

  try {
    const result = await researchCompany(company.name ?? company.domain, company.domain);
    if (!result.industry && !result.employeeRange && !result.linkedinUrl && !result.summary) {
      return { ok: false, message: "Web research found nothing new for this company." };
    }

    const existingRaw =
      company.raw && typeof company.raw === "object" ? (company.raw as Record<string, unknown>) : {};

    await db()
      .update(schema.companies)
      .set({
        industry: result.industry ?? company.industry,
        employeeRange: result.employeeRange ?? company.employeeRange,
        linkedinUrl: result.linkedinUrl ?? company.linkedinUrl,
        raw: { ...existingRaw, webResearch: result },
        enrichedAt: new Date(),
      })
      .where(eq(schema.companies.id, company.id));
  } catch (error) {
    const message =
      error instanceof CompanyResearchError || error instanceof AiSignalError
        ? error.message
        : "Could not research this company.";
    return { ok: false, message };
  }

  revalidatePath(`/people/${personId}`);
  return { ok: true, message: "Company profile updated from web research." };
}
