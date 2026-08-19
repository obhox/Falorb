import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { DateRange } from "@falorb/queries";
import { crossProjectPeople } from "./analytics";
import { listPeople, type PersonRow } from "./people";

export interface HotLead {
  personId: string;
  identifiedId: string | null;
  email: string | null;
  name: string | null;
  leadScore: number;
  totalSessions: number;
  totalPageviews: number;
  totalRevenue: string;
  lastSeenAt: string;
  companyName: string | null;
  companyDomain: string | null;
  companyIndustry: string | null;
  interestScores: unknown;
  /** How many of the organization's properties this person has been seen on. */
  projectCount: number;
  /** Owner-set outreach marker — see `persons.contactedAt` in the schema. */
  contactedAt: string | null;
  contactedBy: string | null;
}

/**
 * Ranked leads worth personally reaching out to, in one of two scopes.
 *
 *  - **"project"**: people on this one property, ranked by lead score. Reuses
 *    `listPeople` directly — the People page's own query — no ClickHouse call.
 *  - **"portfolio"**: people active across 2+ properties, the thing a
 *    per-project view structurally cannot see. `crossProjectPeople`
 *    (`packages/queries/src/overview.ts`) floors `minProjects` at 2
 *    (`Math.max(2, options.minProjects ?? 2)`) — passing a single project's
 *    id through it would always return zero rows, which is why "project"
 *    scope bypasses it entirely rather than trying to force it through the
 *    same call with `minProjects: 1`.
 *
 * Either way the caller gets the same shape back, so the panel that renders
 * this doesn't need to know which path produced it.
 */
export async function hotLeads(
  organizationId: string,
  scope: "project" | "portfolio",
  projectIds: number[],
  range: DateRange,
  limit = 20,
): Promise<HotLead[]> {
  if (scope === "project") {
    const page = await listPeople({ organizationId, projectIds, sort: "lead_score", limit });
    return page.people.map((row) =>
      toHotLead(row.person, row.companyName, row.companyDomain, null, 1),
    );
  }

  const crossProject = await crossProjectPeople({ projectIds, range, minProjects: 2, limit });
  if (crossProject.length === 0) return [];

  const ids = crossProject.map((row) => row.person_id);
  const rows = await db()
    .select({
      person: schema.persons,
      companyName: schema.companies.name,
      companyDomain: schema.companies.domain,
      companyIndustry: schema.companies.industry,
    })
    .from(schema.persons)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.persons.companyId))
    .where(
      and(
        eq(schema.persons.organizationId, organizationId),
        inArray(schema.persons.id, ids),
        isNull(schema.persons.deletedAt),
      ),
    );

  // ClickHouse's person_id is already merge-resolved (crossProjectPeople reads
  // events_v), but a session that hasn't closed yet can still outrun the
  // sessionizer — filter rather than assume every id has a Postgres row.
  const byId = new Map(rows.map((row) => [row.person.id, row]));

  return crossProject
    .map((row) => {
      const match = byId.get(row.person_id);
      return match
        ? toHotLead(match.person, match.companyName, match.companyDomain, match.companyIndustry, row.project_count)
        : null;
    })
    .filter((lead): lead is HotLead => lead != null)
    .sort((a, b) => b.leadScore - a.leadScore || b.projectCount - a.projectCount)
    .slice(0, limit);
}

function toHotLead(
  person: PersonRow,
  companyName: string | null,
  companyDomain: string | null,
  companyIndustry: string | null,
  projectCount: number,
): HotLead {
  return {
    personId: person.id,
    identifiedId: person.identifiedId,
    email: person.email,
    name: person.name,
    leadScore: person.leadScore,
    totalSessions: person.totalSessions,
    totalPageviews: person.totalPageviews,
    totalRevenue: person.totalRevenue,
    lastSeenAt: person.lastSeenAt.toISOString(),
    companyName,
    companyDomain,
    companyIndustry,
    interestScores: person.interestScores,
    projectCount,
    contactedAt: person.contactedAt?.toISOString() ?? null,
    contactedBy: person.contactedBy,
  };
}

/**
 * One lead by person id, for drafting an outreach message about them.
 *
 * Scoped by `organizationId` only, not by a project — the "portfolio" scope
 * of `hotLeads` above can surface a person whose alias rows sit on a
 * different project than whatever page the caller is standing on, and the
 * outreach draft is about the person, not about the property.
 */
export async function getHotLead(personId: string, organizationId: string): Promise<HotLead | null> {
  const [row] = await db()
    .select({
      person: schema.persons,
      companyName: schema.companies.name,
      companyDomain: schema.companies.domain,
      companyIndustry: schema.companies.industry,
    })
    .from(schema.persons)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.persons.companyId))
    .where(
      and(
        eq(schema.persons.id, personId),
        eq(schema.persons.organizationId, organizationId),
        isNull(schema.persons.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  return toHotLead(row.person, row.companyName, row.companyDomain, row.companyIndustry, row.person.projectIds.length);
}
