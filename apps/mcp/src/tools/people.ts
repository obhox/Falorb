import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { schema } from "@falorb/db";
import {
  RANGE_DESCRIPTION,
  acquisitionChain,
  crossProjectPeople,
  parseRange,
  personInterests,
  personList,
  personProjects,
  personTimeline,
  sessionList,
  type Filter,
} from "@falorb/queries";
import type { McpContext } from "../context";
import { projectName, resolveProjects } from "../context";
import { ago, duration, failure, money, num, pct, table, text } from "../format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerPeopleTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_people",
    {
      title: "List people",
      description:
        "List visitors with their behavioural summary, most recently active first. Supports the same filters as the analytics tools, so you can ask for e.g. everyone from Nigeria who viewed pricing.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all".'),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        filters: z
          .array(z.record(z.string(), z.unknown()))
          .optional()
          .describe("Optional filters; see describe_filters."),
        limit: z.number().int().min(1).max(200).optional().default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, filters, limit }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const rows = await personList(clickhouse, {
          projectIds,
          range: parsed,
          filters: filters as Filter[] | undefined,
          limit,
        });

        return text(
          `**People — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "Person", get: (r) => r.person_id.slice(0, 8) },
              { header: "Last seen", get: (r) => ago(r.last_seen) },
              { header: "Sessions", get: (r) => num(r.sessions), align: "right" },
              { header: "Views", get: (r) => num(r.pageviews), align: "right" },
              { header: "First source", get: (r) => r.first_source },
              { header: "Last page", get: (r) => r.last_path },
              { header: "Country", get: (r) => (r.countries ?? []).join(", ") },
              {
                header: "Products",
                get: (r) => (r.project_ids ?? []).map((id) => projectName(scope, id)).join(", "),
              },
              { header: "Revenue", get: (r) => money(r.revenue), align: "right" },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "search_people",
    {
      title: "Search people by identity",
      description:
        "Find a person by email, name, or the user id the site passed to identify(). Use this when you know who you are looking for; use list_people for behavioural queries.",
      inputSchema: {
        query: z.string().min(2).describe("Email, name, or identified user id (partial match)."),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      const { db, scope } = ctx();
      try {
        const like = `%${query}%`;
        const rows = await db
          .select()
          .from(schema.persons)
          .where(
            and(
              eq(schema.persons.organizationId, scope.organizationId),
              isNull(schema.persons.deletedAt),
              or(
                ilike(schema.persons.email, like),
                ilike(schema.persons.name, like),
                ilike(schema.persons.identifiedId, like),
              ),
            ),
          )
          .limit(limit);

        if (!rows.length) return text(`No person matches "${query}".`);

        return text(
          table(rows, [
            { header: "Person", get: (r) => r.id },
            { header: "Identified as", get: (r) => r.identifiedId },
            { header: "Email", get: (r) => r.email },
            { header: "Name", get: (r) => r.name },
            { header: "Last seen", get: (r) => ago(r.lastSeenAt?.toISOString()) },
            { header: "Sessions", get: (r) => num(r.totalSessions), align: "right" },
            { header: "Revenue", get: (r) => money(r.totalRevenue), align: "right" },
            { header: "Score", get: (r) => r.leadScore, align: "right" },
          ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_person",
    {
      title: "Full person profile",
      description:
        "Everything known about one person: identity and traits, company, which of your products they have used, complete acquisition history (every referring site and campaign), inferred interests, and their recent event timeline across all projects. This is the deepest view the platform offers.",
      inputSchema: {
        person_id: z.string().describe("Person UUID, from list_people or search_people."),
        timeline_limit: z.number().int().min(1).max(500).optional().default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ person_id, timeline_limit }) => {
      const { db, clickhouse, scope } = ctx();
      try {
        if (!UUID.test(person_id)) {
          return failure(
            `"${person_id}" is not a full person UUID. The people tables show a shortened id — use search_people or list_people and pass the complete value.`,
          );
        }

        // Tenant check before anything else: a person id from another
        // organization must not resolve, even though it is a valid UUID.
        const [person] = await db
          .select()
          .from(schema.persons)
          .where(
            and(
              eq(schema.persons.id, person_id),
              eq(schema.persons.organizationId, scope.organizationId),
            ),
          )
          .limit(1);

        const [timeline, products, acquisition, interests] = await Promise.all([
          personTimeline(clickhouse, {
            personId: person_id,
            projectIds: scope.projectIds,
            limit: timeline_limit,
          }),
          personProjects(clickhouse, { personId: person_id, projectIds: scope.projectIds }),
          acquisitionChain(clickhouse, { personId: person_id, projectIds: scope.projectIds, limit: 50 }),
          personInterests(clickhouse, { personId: person_id, projectIds: scope.projectIds, limit: 15 }),
        ]);

        if (!person && !timeline.length) {
          return text(`No person ${person_id} in this organization.`);
        }

        let company = "";
        if (person?.companyId) {
          const [row] = await db
            .select()
            .from(schema.companies)
            .where(eq(schema.companies.id, person.companyId))
            .limit(1);
          if (row) company = `${row.name ?? row.domain}${row.industry ? ` · ${row.industry}` : ""}`;
        }

        const identity = person
          ? table(
              [
                { k: "Identified as", v: person.identifiedId ?? "anonymous" },
                { k: "Email", v: person.email ?? "—" },
                { k: "Name", v: person.name ?? "—" },
                { k: "Company", v: company || "—" },
                { k: "First seen", v: ago(person.firstSeenAt?.toISOString()) },
                { k: "Last seen", v: ago(person.lastSeenAt?.toISOString()) },
                { k: "Sessions", v: num(person.totalSessions) },
                { k: "Pageviews", v: num(person.totalPageviews) },
                { k: "Revenue", v: money(person.totalRevenue) },
                { k: "Lead score", v: `${person.leadScore}/100` },
                { k: "First touch", v: `${person.firstChannel ?? "—"} · ${person.firstSource ?? "—"}` },
                { k: "Landed on", v: person.firstLandingPath ?? "—" },
                { k: "Last device", v: `${person.lastDeviceType ?? "—"} · ${person.lastBrowser ?? "—"}` },
                { k: "Location", v: [person.lastCity, person.lastCountry].filter(Boolean).join(", ") || "—" },
              ],
              [
                { header: "Field", get: (r) => r.k },
                { header: "Value", get: (r) => r.v },
              ],
            )
          : "_No stored profile — this person is still anonymous; the behavioural history below is all that exists._";

        const traits =
          person && Object.keys(person.traits as object).length
            ? "\n\n### Traits\n```json\n" + JSON.stringify(person.traits, null, 2) + "\n```"
            : "";

        const interestBlock = interests.length
          ? table(interests, [
              { header: "Topic", get: (r) => r.topic },
              { header: "Events", get: (r) => num(r.events), align: "right" },
              { header: "Last", get: (r) => ago(r.last_seen) },
            ])
          : "No topic signal yet.";

        const scored =
          person && Object.keys(person.interestScores as object).length
            ? "\n\nWeighted scores (rarity-adjusted, time-decayed): `" +
              JSON.stringify(person.interestScores) +
              "`"
            : "";

        return text(
          `# Person ${person_id.slice(0, 8)}\n\n` +
            identity +
            traits +
            `\n\n### Products used (${products.length})\n` +
            table(
              products,
              [
                { header: "Project", get: (r) => projectName(scope, r.project_id) },
                { header: "First seen", get: (r) => ago(r.first_seen) },
                { header: "Last seen", get: (r) => ago(r.last_seen) },
                { header: "Sessions", get: (r) => num(r.sessions), align: "right" },
                { header: "Views", get: (r) => num(r.pageviews), align: "right" },
                { header: "Revenue", get: (r) => money(r.revenue), align: "right" },
                { header: "Top pages", get: (r) => (r.top_paths ?? []).slice(0, 3).join(", ") },
              ],
              "No project activity.",
            ) +
            `\n\n### Acquisition history\n` +
            table(
              acquisition,
              [
                { header: "When", get: (r) => ago(r.started_at) },
                { header: "Project", get: (r) => projectName(scope, r.project_id) },
                { header: "Channel", get: (r) => r.channel },
                { header: "Source", get: (r) => r.source },
                { header: "Referrer", get: (r) => r.referrer_host },
                { header: "Campaign", get: (r) => r.utm_campaign },
                { header: "Landed on", get: (r) => r.landing_path },
              ],
              "No sessions recorded.",
            ) +
            `\n\n### Interests\n` +
            interestBlock +
            scored +
            `\n\n### Recent activity (${timeline.length} events)\n` +
            table(
              timeline,
              [
                { header: "When", get: (r) => ago(r.timestamp) },
                { header: "Project", get: (r) => projectName(scope, r.project_id) },
                { header: "Event", get: (r) => r.name },
                { header: "Page", get: (r) => r.path },
                { header: "Time on page", get: (r) => (r.duration_ms ? duration(r.duration_ms / 1000) : "") },
              ],
              "No events.",
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "find_cross_project_people",
    {
      title: "People who used multiple products",
      description:
        "Find people who have been active on more than one of your projects. These are your warmest leads — someone who read the blog and then visited a different product's pricing page is a materially different prospect from a first-time visitor. Identity is unified only through a deterministic signal (the same identify() id, or a click between your own domains).",
      inputSchema: {
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        min_projects: z.number().int().min(2).max(10).optional().default(2),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ range, min_projects, limit }) => {
      const { clickhouse, scope } = ctx();
      try {
        const parsed = parseRange(range);
        const rows = await crossProjectPeople(clickhouse, {
          projectIds: scope.projectIds,
          range: parsed,
          minProjects: min_projects,
          limit,
        });

        if (!rows.length) {
          return text(
            `No person has used ${min_projects}+ projects in ${parsed.label}.\n\n` +
              `Cross-project identity requires the same \`identify()\` id on both sites. If your products do not call identify() with a shared user id, this will stay empty by design — anonymous visitors are deliberately never merged across domains.`,
          );
        }

        return text(
          `**Cross-project people — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "Person", get: (r) => r.person_id },
              { header: "Products", get: (r) => r.project_count, align: "right" },
              {
                header: "Which",
                get: (r) => (r.project_ids ?? []).map((id) => projectName(scope, id)).join(", "),
              },
              { header: "First seen", get: (r) => ago(r.first_seen) },
              { header: "Last seen", get: (r) => ago(r.last_seen) },
              { header: "Events", get: (r) => num(r.total_events), align: "right" },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description:
        "Individual sessions with entry and exit page, duration, bounce, scroll depth and frustration signals. Pass a person_id to see one person's visit history.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all".'),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        person_id: z.string().optional().describe("Restrict to one person (full UUID)."),
        limit: z.number().int().min(1).max(200).optional().default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, person_id, limit }) => {
      const { clickhouse, scope } = ctx();
      try {
        if (person_id && !UUID.test(person_id)) {
          return failure(`"${person_id}" is not a full person UUID.`);
        }
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const rows = await sessionList(clickhouse, {
          projectIds,
          range: parsed,
          personId: person_id,
          limit,
        });

        return text(
          `**Sessions — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "Started", get: (r) => ago(r.started_at) },
              { header: "Project", get: (r) => projectName(scope, r.project_id) },
              { header: "Entry", get: (r) => r.entry_path },
              { header: "→ Exit", get: (r) => r.exit_path },
              { header: "Views", get: (r) => num(r.pageviews), align: "right" },
              { header: "Duration", get: (r) => duration(r.duration_sec), align: "right" },
              { header: "Scroll", get: (r) => pct(r.max_scroll, 0), align: "right" },
              { header: "Bounce", get: (r) => (r.is_bounce ? "yes" : "") },
              { header: "Rage", get: (r) => (Number(r.rage_clicks) ? num(r.rage_clicks) : "") },
              { header: "Source", get: (r) => r.source },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
