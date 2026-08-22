import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { complete } from "@falorb/ai";
import { schema } from "@falorb/db";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * People discovered off-site — not yet a tracked visitor — via social
 * listening and job-post scanning (FEATURES.md §17). This is a different
 * surface from `people.ts`'s CRM/on-site leads: a prospect is someone found
 * *before* they ever touch a property, and the question is whether they are
 * worth approaching at all.
 *
 * `draft_prospect_outreach` builds its own prompt through `@falorb/ai`
 * directly, the same way `content.ts`'s `draft_text` does, rather than
 * importing the app-layer `generateProspectOutreachMessage` — `@falorb/agents`
 * does not depend on the Next.js app.
 */

const STATUSES = ["new", "enriching", "enriched", "contacted", "dismissed"] as const;

async function requireProspect(ctx: AgentContext, prospectId: string) {
  const [prospect] = await ctx.db
    .select()
    .from(schema.prospects)
    .where(
      and(eq(schema.prospects.id, prospectId), eq(schema.prospects.organizationId, ctx.organizationId)),
    )
    .limit(1);
  if (!prospect) throw new Error("No such prospect in this workspace.");
  return prospect;
}

export const prospectingTools: AnyToolDefinition[] = [
  defineTool({
    name: "list_prospects",
    toolkit: "prospecting",
    description:
      "People discovered off-site by social listening or job scanning, not yet a tracked " +
      "visitor. Defaults to what still needs a decision — enriched but neither contacted nor " +
      "dismissed.",
    input: z.object({
      status: z.enum(STATUSES).optional().describe("Omit for 'enriched' — the queue awaiting a decision."),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `List ${a.status ?? "enriched"} prospects`,
    execute: async (ctx, a) => {
      return ctx.db
        .select({
          id: schema.prospects.id,
          source: schema.prospects.source,
          sourceUrl: schema.prospects.sourceUrl,
          authorHandle: schema.prospects.authorHandle,
          title: schema.prospects.title,
          excerpt: schema.prospects.excerpt,
          matchedKeywords: schema.prospects.matchedKeywords,
          relevanceScore: schema.prospects.relevanceScore,
          relevanceRationale: schema.prospects.relevanceRationale,
          contactName: schema.prospects.contactName,
          contactTitle: schema.prospects.contactTitle,
          status: schema.prospects.status,
          createdAt: schema.prospects.createdAt,
        })
        .from(schema.prospects)
        .where(
          and(
            eq(schema.prospects.organizationId, ctx.organizationId),
            eq(schema.prospects.status, a.status ?? "enriched"),
          ),
        )
        .orderBy(desc(schema.prospects.createdAt))
        .limit(a.limit);
    },
  }),

  defineTool({
    name: "get_prospect",
    toolkit: "prospecting",
    description: "One prospect in full, including whatever contact enrichment was found.",
    input: z.object({ prospectId: z.string().uuid() }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Read prospect ${a.prospectId.slice(0, 8)}`,
    execute: async (ctx, a) => requireProspect(ctx, a.prospectId),
  }),

  defineTool({
    name: "mark_prospect_contacted",
    toolkit: "prospecting",
    description: "Record that this prospect has been reached out to, so nobody else duplicates it.",
    input: z.object({ prospectId: z.string().uuid() }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Mark prospect ${a.prospectId.slice(0, 8)} contacted`,
    execute: async (ctx, a) => {
      await requireProspect(ctx, a.prospectId);
      await ctx.db
        .update(schema.prospects)
        .set({ status: "contacted", contactedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.prospects.id, a.prospectId));
      return { ok: true };
    },
  }),

  defineTool({
    name: "dismiss_prospect",
    toolkit: "prospecting",
    description:
      "Drop a prospect that does not clear the bar for outreach. Say so plainly rather than " +
      "manufacturing a reason to contact someone who doesn't fit.",
    input: z.object({ prospectId: z.string().uuid() }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Dismiss prospect ${a.prospectId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      await requireProspect(ctx, a.prospectId);
      await ctx.db
        .update(schema.prospects)
        .set({ status: "dismissed", dismissedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.prospects.id, a.prospectId));
      return { ok: true };
    },
  }),

  defineTool({
    name: "draft_prospect_outreach",
    toolkit: "prospecting",
    description:
      "Write a first-touch message to a prospect, grounded in what they actually posted. " +
      "Returns the draft — it is not sent. Attach it to a task or propose it for approval.",
    input: z.object({
      prospectId: z.string().uuid(),
      angle: z
        .string()
        .max(500)
        .optional()
        .describe("What you want this message to lead with, if anything specific."),
    }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Draft outreach for prospect ${a.prospectId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const prospect = await requireProspect(ctx, a.prospectId);

      const system =
        "You are drafting a first-touch outreach message on behalf of a small business, " +
        "referring to something the recipient actually posted publicly. Be specific to the " +
        "facts given; never invent a detail that is not in the context. Keep it under 120 " +
        "words, plain text, no markdown, no subject line unless asked for one.";

      const context = [
        `Source: ${prospect.source} (${prospect.sourceType})`,
        prospect.title ? `Title: ${prospect.title}` : null,
        `Excerpt: ${prospect.excerpt}`,
        prospect.matchedKeywords.length ? `Matched on: ${prospect.matchedKeywords.join(", ")}` : null,
        prospect.contactName ? `Contact name: ${prospect.contactName}` : null,
        prospect.contactTitle ? `Contact title: ${prospect.contactTitle}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const draft = await complete(
        system,
        { instruction: a.angle ?? "Write the message.", context },
        { maxTokens: 400, stripMarkdown: true, credentials: ctx.credentials },
      );

      return { draft };
    },
  }),
];
