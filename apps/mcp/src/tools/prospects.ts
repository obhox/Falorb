import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@falorb/db";
import { AiSignalError, complete } from "@falorb/ai";
import { PROSPECT_SOURCES } from "@falorb/core";
import type { McpContext, Scope } from "../context";
import { requireScope, resolveProjects, ScopeError } from "../context";
import { ago, failure, table, text } from "../format";

/**
 * Prospects discovered off-site (social listening across Reddit, Hacker
 * News, and job postings) and their contact enrichment — the other half of
 * "who to contact" alongside `leads.ts`'s on-site hot leads. Connect/
 * disconnect for the Clay/Exa/Firecrawl integrations is deliberately **not**
 * exposed here, matching FEATURES.md §13's stated rule for integrations
 * generally: connect/disconnect stays a dashboard action, only read tools
 * are available over MCP. Re-crawling a property's profile is the same kind
 * of action (spends a connected org's own paid Exa/Firecrawl credits) and
 * is likewise dashboard-only — see `apps/web/src/server/actions/property-profile.ts`.
 */
export function registerProspectTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_prospect_sources",
    {
      title: "What each prospecting source is",
      description:
        "Describes every listening source `list_prospects`/`get_prospect` can return (Reddit, Hacker News, job postings today) — what it is and why a match there is worth reading. Call this before reasoning about a batch of prospects from an unfamiliar source.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      return text(
        table(
          Object.values(PROSPECT_SOURCES),
          [
            { header: "Source", get: (s) => s.key },
            { header: "Label", get: (s) => s.label },
            { header: "What it is", get: (s) => s.description },
          ],
        ),
      );
    },
  );

  server.registerTool(
    "list_prospects",
    {
      title: "Prospects discovered off-site",
      description:
        "People, accounts, or job postings discovered talking about (or hiring for) something relevant to the product, somewhere the organization doesn't own — Reddit, Hacker News, and job postings today (see list_prospect_sources). Optionally enriched with contact info. Complements get_hot_leads, which only covers people already tracked as on-site visitors.",
      inputSchema: {
        project: z.string().optional().describe('Project slug to filter by its keyword list; omit or "all" for the whole portfolio.'),
        status: z.enum(["new", "enriching", "enriched", "contacted", "dismissed"]).optional(),
        limit: z.number().int().min(1).max(100).optional().default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, status, limit }) => {
      const { db, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const conditions = [
          eq(schema.prospects.organizationId, scope.organizationId),
          inArray(schema.prospects.projectId, projectIds),
        ];
        if (status) conditions.push(eq(schema.prospects.status, status));

        const rows = await db
          .select()
          .from(schema.prospects)
          .where(and(...conditions))
          .orderBy(desc(schema.prospects.createdAt))
          .limit(limit);

        return text(
          table(rows, [
            { header: "ID", get: (r) => r.id.slice(0, 8) },
            { header: "Source", get: (r) => r.source },
            { header: "Title", get: (r) => r.title ?? r.excerpt.slice(0, 60) },
            { header: "Keywords", get: (r) => r.matchedKeywords.join(", ") },
            { header: "Relevance", get: (r) => r.relevanceScore, align: "right" },
            { header: "Status", get: (r) => r.status },
            { header: "Contact", get: (r) => r.contactEmail ?? (r.contactName ? "found, no email" : "—") },
            { header: "Discovered", get: (r) => ago(r.createdAt.toISOString()) },
          ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_prospect",
    {
      title: "One prospect's full detail",
      description: "Full detail for one discovered prospect, including the source excerpt and any enrichment, for deciding on or drafting outreach.",
      inputSchema: { prospect_id: z.string().describe("Prospect UUID, from list_prospects.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ prospect_id }) => {
      const { db, scope } = ctx();
      try {
        const [row] = await db
          .select()
          .from(schema.prospects)
          .where(and(eq(schema.prospects.id, prospect_id), eq(schema.prospects.organizationId, scope.organizationId)))
          .limit(1);
        if (!row) return failure("No such prospect.");

        return text(
          table(
            [
              { k: "Source", v: `${row.source} (${row.sourceType})` },
              { k: "URL", v: row.sourceUrl },
              { k: "Title", v: row.title ?? "—" },
              { k: "Excerpt", v: row.excerpt },
              { k: "Author", v: row.authorHandle ?? "—" },
              { k: "Matched keywords", v: row.matchedKeywords.join(", ") || "—" },
              { k: "Relevance", v: row.relevanceScore != null ? `${row.relevanceScore}/100 — ${row.relevanceRationale ?? ""}` : "not scored" },
              { k: "Contact", v: [row.contactName, row.contactTitle, row.contactEmail].filter(Boolean).join(" · ") || "not enriched" },
              { k: "LinkedIn", v: row.contactLinkedinUrl ?? "—" },
              { k: "Status", v: row.status },
              { k: "Contacted", v: row.contactedAt ? `yes, ${ago(row.contactedAt.toISOString())}` : "no" },
              { k: "Discovered", v: ago(row.createdAt.toISOString()) },
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
    "list_prospect_keywords",
    {
      title: "Listening keywords per property",
      description: "What each property is watching for across all listening sources (Reddit, Hacker News, job postings — see list_prospect_sources).",
      inputSchema: {
        project: z.string().optional().describe('Project slug; omit or "all" for every property.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const rows = await db
          .select()
          .from(schema.prospectKeywords)
          .where(inArray(schema.prospectKeywords.projectId, projectIds))
          .orderBy(schema.prospectKeywords.keyword);

        return text(
          table(rows, [
            { header: "Project", get: (r) => scope.projects.find((p) => p.id === r.projectId)?.slug ?? String(r.projectId) },
            { header: "Keyword", get: (r) => r.keyword },
            { header: "Active", get: (r) => (r.active ? "yes" : "paused") },
          ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "mark_prospect_contacted",
    {
      title: "Mark a prospect as contacted (or not)",
      description: "Set or clear the owner-set outreach marker on a prospect. Requires the write scope.",
      inputSchema: { prospect_id: z.string(), contacted: z.boolean() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ prospect_id, contacted }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [updated] = await db
          .update(schema.prospects)
          .set({
            status: contacted ? "contacted" : "enriched",
            contactedAt: contacted ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.prospects.id, prospect_id), eq(schema.prospects.organizationId, scope.organizationId)))
          .returning({ id: schema.prospects.id });

        if (!updated) return failure("No such prospect.");
        return text(contacted ? "Marked as contacted." : "Marked as not contacted.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "dismiss_prospect",
    {
      title: "Dismiss a prospect",
      description: "Mark a prospect as not worth pursuing — reversible, just a status, nothing is deleted. Requires the write scope.",
      inputSchema: { prospect_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ prospect_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [updated] = await db
          .update(schema.prospects)
          .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.prospects.id, prospect_id), eq(schema.prospects.organizationId, scope.organizationId)))
          .returning({ id: schema.prospects.id });

        if (!updated) return failure("No such prospect.");
        return text("Dismissed.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "draft_prospect_outreach",
    {
      title: "Draft a first-touch outreach message for a prospect",
      description:
        "Generate a short cold-outreach draft grounded in the prospect's public post — not a warm on-site lead, so the draft never implies a prior relationship. Returns the draft text only; does not send anything. Requires the write scope.",
      inputSchema: {
        prospect_id: z.string(),
        project: z.string().optional().describe("Project slug, used only to name the sender's product in the draft."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ prospect_id, project }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const [row] = await db
          .select()
          .from(schema.prospects)
          .where(and(eq(schema.prospects.id, prospect_id), eq(schema.prospects.organizationId, scope.organizationId)))
          .limit(1);
        if (!row) return failure("No such prospect.");

        const matchedProject = project
          ? scope.projects.find((p) => p.slug === project)
          : (scope.projects.find((p) => p.id === row.projectId) ?? scope.projects[0]);
        const projectName = matchedProject?.name;
        const propertySummary = matchedProject?.profileSummary ?? null;

        try {
          const draft = await complete(
            `You are drafting a first cold-outreach message from ${projectName ?? "the company"} to someone who ` +
              `posted publicly on ${row.source}, matched because it mentioned something relevant to the ` +
              "product. This is cold outreach, not a warm on-site lead — ground the message in the specific " +
              "post (its title/content and the matched keyword), and do not imply any prior relationship or " +
              "that they have visited the product's site. Write 3-5 short sentences. Use their name only if " +
              "one is given, otherwise address them generically. No markdown, no subject line, no greeting " +
              "placeholder brackets like [Name] — just the message body, ready to send." +
              (propertySummary ? ` What ${projectName} actually does, to draw on: ${propertySummary}` : ""),
            {
              handle: row.authorHandle,
              source: row.source,
              sourceType: row.sourceType,
              postTitle: row.title,
              postExcerpt: row.excerpt,
              matchedKeywords: row.matchedKeywords,
              postedAt: row.postedAt?.toISOString() ?? null,
              contactName: row.contactName,
              contactTitle: row.contactTitle,
              contactCompanyDomain: row.contactCompanyDomain,
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

  server.registerTool(
    "add_prospect_keyword",
    {
      title: "Add a listening keyword to a property",
      description: "Watch for a new term on social listening sources for one property. Requires the write scope.",
      inputSchema: { project: z.string().describe("Project slug."), keyword: z.string().min(1).max(100) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project, keyword }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const projectId = resolveOneProject(scope, project);

        await db
          .insert(schema.prospectKeywords)
          .values({ projectId, keyword: keyword.trim() })
          .onConflictDoNothing({
            target: [schema.prospectKeywords.projectId, schema.prospectKeywords.keyword],
          });

        return text(`Now listening for "${keyword.trim()}".`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "remove_prospect_keyword",
    {
      title: "Remove a listening keyword",
      description: "Stop watching for a keyword. Requires the write scope.",
      inputSchema: { project: z.string().describe("Project slug."), keyword: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ project, keyword }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const projectId = resolveOneProject(scope, project);

        await db
          .delete(schema.prospectKeywords)
          .where(and(eq(schema.prospectKeywords.projectId, projectId), eq(schema.prospectKeywords.keyword, keyword.trim())));

        return text(`Stopped listening for "${keyword.trim()}".`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

/** Keyword mutations need exactly one project, unlike every read tool above
 * which is happy to resolve "all" into the whole portfolio. */
function resolveOneProject(scope: Scope, project: string): number {
  const ids = resolveProjects(scope, project);
  if (project.toLowerCase() === "all" || ids.length !== 1) {
    throw new ScopeError('A single project slug is required here, not "all".');
  }
  return ids[0]!;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
