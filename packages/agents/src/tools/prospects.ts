import { z } from "zod";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { schema } from "@falorb/db";
import { complete } from "@falorb/ai";
import { PROSPECT_SOURCES } from "@falorb/core";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * Off-site listening (Reddit, Hacker News, job postings) — the other half of
 * "who to contact" alongside `leads`, which only covers people already
 * tracked as on-site visitors. Everything here is already running on
 * connected Clay/Exa/Firecrawl credentials; this toolkit does not add a new
 * integration, only agent access to one that already exists.
 *
 * Deliberately does not expose connect/disconnect or re-crawl: FEATURES.md
 * §13's stated rule keeps those dashboard-only because they spend a
 * connected org's own paid credits, and `apps/mcp/src/tools/prospects.ts`
 * already draws that same line for the read-only MCP surface. This toolkit
 * inherits the boundary rather than re-deciding it — read, triage, and
 * draft, nothing that spends money.
 */

const STATUSES = ["new", "enriching", "enriched", "contacted", "dismissed"] as const;

/** A prospect scoped to no project (its property was deleted) is still
 * visible — it has nothing left to be out of scope of. One that belongs to
 * a real property must be one this agent was actually given. */
function scopeCondition(ctx: AgentContext) {
  return or(isNull(schema.prospects.projectId), inArray(schema.prospects.projectId, ctx.projectIds));
}

async function requireProspect(ctx: AgentContext, prospectId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.prospects)
    .where(
      and(
        eq(schema.prospects.id, prospectId),
        eq(schema.prospects.organizationId, ctx.organizationId),
        scopeCondition(ctx),
      ),
    )
    .limit(1);
  if (!row) throw new Error("No such prospect in this workspace, or it is out of this agent's scope.");
  return row;
}

export const prospectsTools: AnyToolDefinition[] = [
  defineTool({
    name: "list_prospect_sources",
    toolkit: "prospects",
    description:
      "What each listening source is (Reddit, Hacker News, job postings today) and why a " +
      "match there is worth reading. Call this before reasoning about a batch of prospects " +
      "from an unfamiliar source.",
    input: z.object({}),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: () => "List prospect sources",
    execute: async () => Object.values(PROSPECT_SOURCES),
  }),

  defineTool({
    name: "list_prospects",
    toolkit: "prospects",
    description:
      "People, accounts, or job postings discovered talking about (or hiring for) something " +
      "relevant to the product, somewhere the organization doesn't own. Optionally enriched " +
      "with contact info. Complements get_hot_leads, which only covers on-site visitors.",
    input: z.object({
      status: z.enum(STATUSES).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => (a.status ? `List ${a.status} prospects` : "List prospects"),
    execute: async (ctx, a) => {
      const conditions = [eq(schema.prospects.organizationId, ctx.organizationId), scopeCondition(ctx)];
      if (a.status) conditions.push(eq(schema.prospects.status, a.status));

      return ctx.db
        .select({
          id: schema.prospects.id,
          source: schema.prospects.source,
          title: schema.prospects.title,
          excerpt: schema.prospects.excerpt,
          matchedKeywords: schema.prospects.matchedKeywords,
          relevanceScore: schema.prospects.relevanceScore,
          status: schema.prospects.status,
          contactName: schema.prospects.contactName,
          contactEmail: schema.prospects.contactEmail,
          contactedAt: schema.prospects.contactedAt,
          createdAt: schema.prospects.createdAt,
        })
        .from(schema.prospects)
        .where(and(...conditions))
        .orderBy(desc(schema.prospects.createdAt))
        .limit(a.limit);
    },
  }),

  defineTool({
    name: "get_prospect",
    toolkit: "prospects",
    description:
      "Full detail for one discovered prospect, including the source excerpt and any " +
      "enrichment, for deciding on or drafting outreach.",
    input: z.object({ prospectId: z.string().uuid() }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Read prospect ${a.prospectId.slice(0, 8)}`,
    execute: async (ctx, a) => requireProspect(ctx, a.prospectId),
  }),

  defineTool({
    name: "list_prospect_keywords",
    toolkit: "prospects",
    description:
      "What each property is watching for across all listening sources. Check this before " +
      "adding a keyword — it may already be covered by a close variant.",
    input: z.object({}),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: () => "List prospect keywords",
    execute: async (ctx) =>
      ctx.db
        .select({
          projectId: schema.prospectKeywords.projectId,
          keyword: schema.prospectKeywords.keyword,
          active: schema.prospectKeywords.active,
        })
        .from(schema.prospectKeywords)
        .where(inArray(schema.prospectKeywords.projectId, ctx.projectIds))
        .orderBy(schema.prospectKeywords.keyword),
  }),

  defineTool({
    name: "mark_prospect_contacted",
    toolkit: "prospects",
    description:
      "Set or clear the outreach marker on a prospect, so nobody else queues a second cold " +
      "approach to the same person. Set it once you have actually reached out.",
    input: z.object({ prospectId: z.string().uuid(), contacted: z.boolean().default(true) }),
    capability: "manageCrm",
    effect: "internal",
    risk: "low",
    summarize: (a) => (a.contacted ? `Mark prospect ${a.prospectId.slice(0, 8)} contacted` : `Clear contacted on prospect ${a.prospectId.slice(0, 8)}`),
    execute: async (ctx, a) => {
      await requireProspect(ctx, a.prospectId);

      const [updated] = await ctx.db
        .update(schema.prospects)
        .set({
          status: a.contacted ? "contacted" : "enriched",
          contactedAt: a.contacted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.prospects.id, a.prospectId),
            eq(schema.prospects.organizationId, ctx.organizationId),
          ),
        )
        .returning({ id: schema.prospects.id });

      return { ok: Boolean(updated) };
    },
  }),

  defineTool({
    name: "dismiss_prospect",
    toolkit: "prospects",
    description:
      "Mark a prospect as not worth pursuing. Reversible — it is only a status, nothing is " +
      "deleted. Use this to keep the queue honest rather than silently ignoring a bad match.",
    input: z.object({ prospectId: z.string().uuid() }),
    capability: "manageCrm",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Dismiss prospect ${a.prospectId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      await requireProspect(ctx, a.prospectId);

      const [updated] = await ctx.db
        .update(schema.prospects)
        .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.prospects.id, a.prospectId),
            eq(schema.prospects.organizationId, ctx.organizationId),
          ),
        )
        .returning({ id: schema.prospects.id });

      return { ok: Boolean(updated) };
    },
  }),

  defineTool({
    name: "draft_prospect_outreach",
    toolkit: "prospects",
    description:
      "Write a short cold-outreach draft grounded in the prospect's public post — never implies " +
      "a prior relationship, since this is cold outreach, not a warm on-site lead. Returns the " +
      "draft only; it is not sent anywhere.",
    input: z.object({
      prospectId: z.string().uuid(),
      projectSlug: z.string().optional().describe("Names the sender's product in the draft. Defaults to the prospect's own property, or the first in scope."),
    }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Draft outreach for prospect ${a.prospectId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const row = await requireProspect(ctx, a.prospectId);
      const project = a.projectSlug
        ? ctx.projects.find((p) => p.slug.toLowerCase() === a.projectSlug!.toLowerCase())
        : (ctx.projects.find((p) => p.id === row.projectId) ?? ctx.projects[0]);

      const draft = await complete(
        `You are drafting a first cold-outreach message from ${project?.name ?? "the company"} ` +
          `to someone who posted publicly on ${row.source}, matched because it mentioned ` +
          "something relevant to the product. This is cold outreach, not a warm on-site lead — " +
          "ground the message in the specific post (its title/content and the matched keyword), " +
          "and do not imply any prior relationship or that they have visited the product's site. " +
          "Write 3-5 short sentences. Use their name only if one is given, otherwise address " +
          "them generically. No markdown, no subject line, no greeting placeholder brackets " +
          "like [Name] — just the message body, ready to send.",
        {
          handle: row.authorHandle,
          source: row.source,
          sourceType: row.sourceType,
          postTitle: row.title,
          postExcerpt: row.excerpt,
          matchedKeywords: row.matchedKeywords,
          postedAt: row.postedAt,
          contactName: row.contactName,
          contactTitle: row.contactTitle,
          contactCompanyDomain: row.contactCompanyDomain,
        },
        { credentials: ctx.credentials },
      );
      return { draft };
    },
  }),

  defineTool({
    name: "add_prospect_keyword",
    toolkit: "prospects",
    description: "Start watching for a new term on the listening sources for one property.",
    input: z.object({
      projectSlug: z.string(),
      keyword: z.string().min(1).max(100),
    }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Watch for "${a.keyword}" on ${a.projectSlug}`,
    execute: async (ctx, a) => {
      const project = ctx.projects.find((p) => p.slug.toLowerCase() === a.projectSlug.toLowerCase());
      if (!project) throw new Error(`"${a.projectSlug}" is not a property this agent can see.`);

      await ctx.db
        .insert(schema.prospectKeywords)
        .values({ projectId: project.id, keyword: a.keyword.trim() })
        .onConflictDoNothing({
          target: [schema.prospectKeywords.projectId, schema.prospectKeywords.keyword],
        });

      return { ok: true };
    },
  }),

  defineTool({
    name: "remove_prospect_keyword",
    toolkit: "prospects",
    description: "Stop watching for a keyword on one property.",
    input: z.object({ projectSlug: z.string(), keyword: z.string() }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Stop watching for "${a.keyword}" on ${a.projectSlug}`,
    execute: async (ctx, a) => {
      const project = ctx.projects.find((p) => p.slug.toLowerCase() === a.projectSlug.toLowerCase());
      if (!project) throw new Error(`"${a.projectSlug}" is not a property this agent can see.`);

      await ctx.db
        .delete(schema.prospectKeywords)
        .where(
          and(
            eq(schema.prospectKeywords.projectId, project.id),
            eq(schema.prospectKeywords.keyword, a.keyword.trim()),
          ),
        );

      return { ok: true };
    },
  }),
];
