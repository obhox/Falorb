import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, arrayOverlaps, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Database } from "@falorb/db";
import { AiSignalError, complete } from "@falorb/ai";
import { crossProjectPeople, type DateRange } from "@falorb/queries";
import type { McpContext } from "../context";
import { requireScope, resolveProjects } from "../context";
import { parseRange, RANGE_DESCRIPTION } from "../range";
import { ago, failure, money, num, table, text } from "../format";

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
  projectCount: number;
  contactedAt: string | null;
  contactedBy: string | null;
}

function toHotLead(
  person: typeof schema.persons.$inferSelect,
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
 * Ranked leads worth personally reaching out to, in one of two scopes.
 *
 * Mirrors `apps/web/src/server/sales.ts`'s `hotLeads` exactly — "project"
 * ranks people on one property by lead score (a plain Postgres query,
 * no ClickHouse); "portfolio" finds people active across 2+ properties via
 * `crossProjectPeople`, which floors `minProjects` at 2 (a single project's
 * id would always return zero rows through that path).
 */
export async function hotLeads(
  db: Database,
  clickhouse: McpContext["clickhouse"],
  organizationId: string,
  scope: "project" | "portfolio",
  projectIds: number[],
  range: DateRange,
  limit = 20,
): Promise<HotLead[]> {
  if (scope === "project") {
    const rows = await db
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
          isNull(schema.persons.deletedAt),
          arrayOverlaps(schema.persons.projectIds, projectIds),
        ),
      )
      .orderBy(desc(schema.persons.leadScore), desc(schema.persons.lastSeenAt))
      .limit(limit);

    return rows.map((r) => toHotLead(r.person, r.companyName, r.companyDomain, r.companyIndustry, 1));
  }

  const crossProject = await crossProjectPeople(clickhouse, { projectIds, range, minProjects: 2, limit });
  if (crossProject.length === 0) return [];

  const ids = crossProject.map((row) => row.person_id);
  const rows = await db
    .select({
      person: schema.persons,
      companyName: schema.companies.name,
      companyDomain: schema.companies.domain,
      companyIndustry: schema.companies.industry,
    })
    .from(schema.persons)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.persons.companyId))
    .where(and(eq(schema.persons.organizationId, organizationId), inArray(schema.persons.id, ids), isNull(schema.persons.deletedAt)));

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

async function getHotLead(db: Database, personId: string, organizationId: string): Promise<HotLead | null> {
  const [row] = await db
    .select({
      person: schema.persons,
      companyName: schema.companies.name,
      companyDomain: schema.companies.domain,
      companyIndustry: schema.companies.industry,
    })
    .from(schema.persons)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.persons.companyId))
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, organizationId), isNull(schema.persons.deletedAt)))
    .limit(1);

  if (!row) return null;
  return toHotLead(row.person, row.companyName, row.companyDomain, row.companyIndustry, row.person.projectIds.length);
}

/**
 * Ranked leads and outreach drafting — the "sales" half of the growth
 * signals feature. Complements `find_cross_project_people` (`people.ts`)
 * with lead scoring and the same two scopes the Sales panel offers.
 */
export function registerLeadTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "get_hot_leads",
    {
      title: "Ranked leads worth contacting",
      description:
        "The warmest leads, ranked by lead score. scope='project' ranks people on one property; scope='portfolio' finds people active across 2+ of your properties — a materially different signal a single-project view can't see.",
      inputSchema: {
        project: z.string().optional().describe('Project slug for scope="project"; omit (or "all") to rank across every project individually. Ignored for scope="portfolio", which requires 2+ shared projects per person instead.'),
        scope: z.enum(["project", "portfolio"]).optional().default("project"),
        range: z.string().optional().describe(RANGE_DESCRIPTION + " Only affects scope=\"portfolio\"."),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, scope: leadScope, range, limit }) => {
      const { db, clickhouse, scope } = ctx();
      try {
        const parsed = parseRange(range);
        const projectIds = leadScope === "portfolio" ? scope.projectIds : resolveProjects(scope, project);

        const leads = await hotLeads(db, clickhouse, scope.organizationId, leadScope, projectIds, parsed, limit);

        if (!leads.length) return text("No leads match.");

        return text(
          `**Hot leads (${leadScope}) — ${parsed.label}**\n\n` +
            table(leads, [
              { header: "Person", get: (r) => r.personId.slice(0, 8) },
              { header: "Name", get: (r) => r.name ?? r.identifiedId ?? "anonymous" },
              { header: "Email", get: (r) => r.email ?? "—" },
              { header: "Company", get: (r) => r.companyName ?? "—" },
              { header: "Score", get: (r) => r.leadScore, align: "right" },
              { header: "Sessions", get: (r) => num(r.totalSessions), align: "right" },
              { header: "Revenue", get: (r) => money(r.totalRevenue), align: "right" },
              { header: "Products", get: (r) => r.projectCount, align: "right" },
              { header: "Last seen", get: (r) => ago(r.lastSeenAt) },
              { header: "Contacted", get: (r) => (r.contactedAt ? ago(r.contactedAt) : "no") },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_lead",
    {
      title: "One lead's full detail",
      description: "Full lead detail by person id, for deciding on or drafting outreach. Use get_person for the complete behavioural profile.",
      inputSchema: { person_id: z.string().describe("Person UUID, from get_hot_leads or find_cross_project_people.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ person_id }) => {
      const { db, scope } = ctx();
      try {
        const lead = await getHotLead(db, person_id, scope.organizationId);
        if (!lead) return failure("No such lead.");

        return text(
          table(
            [
              { k: "Name", v: lead.name ?? lead.identifiedId ?? "anonymous" },
              { k: "Email", v: lead.email ?? "—" },
              { k: "Company", v: [lead.companyName, lead.companyIndustry].filter(Boolean).join(" · ") || "—" },
              { k: "Lead score", v: `${lead.leadScore}/100` },
              { k: "Sessions", v: num(lead.totalSessions) },
              { k: "Pageviews", v: num(lead.totalPageviews) },
              { k: "Revenue", v: money(lead.totalRevenue) },
              { k: "Products visited", v: String(lead.projectCount) },
              { k: "Last seen", v: ago(lead.lastSeenAt) },
              { k: "Contacted", v: lead.contactedAt ? `yes, ${ago(lead.contactedAt)}` : "no" },
              { k: "Interests", v: JSON.stringify(lead.interestScores) },
            ],
            [
              { header: "Field", get: (r) => r.k },
              { header: "Value", get: (r) => r.v },
            ],
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "mark_lead_contacted",
    {
      title: "Mark a lead as contacted (or not)",
      description: "Set or clear the owner-set outreach marker on a lead. Requires the write scope.",
      inputSchema: {
        person_id: z.string().describe("Person UUID."),
        contacted: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ person_id, contacted }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [updated] = await db
          .update(schema.persons)
          .set({ contactedAt: contacted ? new Date() : null, updatedAt: new Date() })
          .where(and(eq(schema.persons.id, person_id), eq(schema.persons.organizationId, scope.organizationId)))
          .returning({ id: schema.persons.id });

        if (!updated) return failure("No such person.");
        return text(contacted ? "Marked as contacted." : "Marked as not contacted.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "draft_outreach_message",
    {
      title: "Draft a first-touch outreach message for a lead",
      description:
        "Generate a short, personalized first-contact email/DM draft for one lead, grounded in their observed activity (interests, company, engagement). Returns the draft text only — this tool does not send anything. Requires the write scope.",
      inputSchema: {
        person_id: z.string().describe("Person UUID."),
        project: z.string().optional().describe("Project slug, used only to name the sender's product in the draft."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ person_id, project }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const lead = await getHotLead(db, person_id, scope.organizationId);
        if (!lead) return failure("No such lead.");

        const projectName = project ? scope.projects.find((p) => p.slug === project)?.name : scope.projects[0]?.name;

        try {
          const draft = await complete(
            `You are a sales rep at ${projectName ?? "the company"} drafting a first outreach email/DM to a hot ` +
              "lead based on their observed activity. Write 3-5 short sentences, personal and " +
              "specific — reference their interests, company, or activity rather than generic " +
              "praise. No markdown, no subject line, no greeting placeholder brackets like " +
              "[Name] — just the message body, ready to send.",
            {
              name: lead.name ?? lead.identifiedId ?? lead.email,
              email: lead.email,
              company: lead.companyName,
              industry: lead.companyIndustry,
              leadScore: lead.leadScore,
              sessions: lead.totalSessions,
              pageviews: lead.totalPageviews,
              revenue: lead.totalRevenue,
              lastSeenAt: lead.lastSeenAt,
              propertiesVisited: lead.projectCount,
              interests: lead.interestScores,
            },
          );
          return text(draft);
        } catch (error) {
          return failure(error instanceof AiSignalError ? error.message : "Could not draft a message.");
        }
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
