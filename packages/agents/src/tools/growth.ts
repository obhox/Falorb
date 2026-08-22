import { z } from "zod";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema } from "@falorb/db";
import { parseRange, referralClicks, RANGE_DESCRIPTION } from "@falorb/queries";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * Referral links, the cached AI growth-signal library, and the waitlist
 * queue — acquisition surfaces `packages/agents` had no toolkit for.
 *
 * Regenerating a signal (`ai_signals`) is deliberately not exposed here:
 * each kind re-runs a bespoke, expensive analytics query defined entirely
 * in `apps/web/src/server/actions/signals.ts` (breakdowns, hot leads, and
 * their own AI prompt shape), which `@falorb/agents` cannot reach without
 * depending on the Next.js app. This toolkit only reads the cache a human
 * (or a future, package-level regenerate path) has already filled.
 *
 * Enabling/disabling the waitlist is also left out — it is gated by
 * `can.share` (admin-tier, since it changes what is publicly reachable),
 * a deliberately higher bar than every other agent-write capability. This
 * toolkit's writes stay at the same `writeAnalysis` tier as the rest of it.
 */

const REFERRAL_BOOST = 3;
const CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;
const INCENTIVE_KINDS = ["discount", "credit", "unlock"] as const;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function requireProject(ctx: AgentContext, slug: string) {
  const project = ctx.projects.find((p) => p.slug.toLowerCase() === slug.toLowerCase());
  if (!project) {
    throw new Error(
      `Unknown property "${slug}". You can see: ${ctx.projects.map((p) => p.slug).join(", ")}.`,
    );
  }
  return project;
}

export const growthTools: AnyToolDefinition[] = [
  defineTool({
    name: "list_referral_links",
    toolkit: "growth",
    description: "This property's referral links, with click and conversion counts.",
    input: z.object({ project: z.string(), range: z.string().optional().describe(RANGE_DESCRIPTION) }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Referral links for ${a.project}`,
    execute: async (ctx, a) => {
      const project = requireProject(ctx, a.project);
      const links = await ctx.db
        .select()
        .from(schema.referralLinks)
        .where(eq(schema.referralLinks.projectId, project.id))
        .orderBy(asc(schema.referralLinks.createdAt));
      if (!links.length) return [];

      const range = parseRange(a.range);
      const codes = links.map((l) => l.code);
      const [clickRows, converted] = await Promise.all([
        referralClicks(ctx.clickhouse, { projectIds: [project.id], range, limit: 500 }),
        ctx.db
          .select({ code: schema.persons.firstReferralCode })
          .from(schema.persons)
          .where(
            and(
              inArray(schema.persons.firstReferralCode, codes),
              isNotNull(schema.persons.identifiedId),
            ),
          ),
      ]);

      const clicksByCode = new Map(clickRows.map((r) => [r.ref_code, r]));
      const conversionsByCode = new Map<string, number>();
      for (const row of converted) {
        if (row.code) conversionsByCode.set(row.code, (conversionsByCode.get(row.code) ?? 0) + 1);
      }

      return links.map((link) => {
        const click = clicksByCode.get(link.code);
        const visitors = click?.visitors ?? 0;
        const conversions = conversionsByCode.get(link.code) ?? 0;
        return {
          id: link.id,
          code: link.code,
          label: link.label,
          revoked: link.revokedAt !== null,
          clicks: click?.clicks ?? 0,
          visitors,
          conversions,
          conversionRate: visitors > 0 ? Math.round((conversions / visitors) * 1000) / 10 : 0,
        };
      });
    },
  }),

  defineTool({
    name: "create_referral_link",
    toolkit: "growth",
    description: "Create a referral link for this property. The code becomes part of a public URL.",
    input: z.object({
      project: z.string(),
      label: z.string().min(1).max(200),
      code: z.string().optional().describe("Lowercase, hyphenated. Derived from the label if omitted."),
      destinationUrl: z.string().url().optional(),
      incentiveKind: z.enum(INCENTIVE_KINDS).optional(),
      incentiveValue: z.string().max(100).optional().describe('Short display value, e.g. "20% off".'),
    }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Create referral link "${a.label}" for ${a.project}`,
    execute: async (ctx, a) => {
      const project = requireProject(ctx, a.project);
      const code = (a.code?.trim().toLowerCase() || slugify(a.label)).trim();
      if (!CODE_PATTERN.test(code)) {
        throw new Error("Codes are 3-64 characters, lowercase letters, numbers and hyphens only.");
      }
      if (a.incentiveKind && !a.incentiveValue) {
        throw new Error('Give the incentive a short value to show, e.g. "20% off".');
      }

      try {
        const [row] = await ctx.db
          .insert(schema.referralLinks)
          .values({
            projectId: project.id,
            code,
            label: a.label,
            destinationUrl: a.destinationUrl ?? null,
            incentiveKind: a.incentiveKind ?? null,
            incentiveValue: a.incentiveKind ? a.incentiveValue : null,
          })
          .returning({ id: schema.referralLinks.id, code: schema.referralLinks.code });
        ctx.log(`Created referral link: ${a.label}`);
        return row;
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) {
          throw new Error(`"${code}" is already in use — pick another code.`);
        }
        throw error;
      }
    },
  }),

  defineTool({
    name: "revoke_referral_link",
    toolkit: "growth",
    description: "Revoke a referral link so it stops redirecting.",
    input: z.object({ linkId: z.string().uuid() }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Revoke referral link ${a.linkId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const [revoked] = await ctx.db
        .update(schema.referralLinks)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.referralLinks.id, a.linkId),
            inArray(
              schema.referralLinks.projectId,
              ctx.projectIds.length ? ctx.projectIds : [-1],
            ),
          ),
        )
        .returning({ id: schema.referralLinks.id });
      if (!revoked) throw new Error("No such referral link in your scope.");
      return { ok: true };
    },
  }),

  defineTool({
    name: "get_latest_signal",
    toolkit: "growth",
    description:
      "The most recently cached AI growth recommendation of a given kind — content, sales, " +
      "marketing or product. Read-only: regenerating one is a person's job, from the dashboard.",
    input: z.object({
      project: z.string().optional().describe('Omit for the portfolio-wide "sales" scope.'),
      kind: z.enum(["content", "sales", "marketing", "product"]),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Latest ${a.kind} signal for ${a.project ?? "the portfolio"}`,
    execute: async (ctx, a) => {
      const projectId = a.project ? requireProject(ctx, a.project).id : null;
      const conditions = [eq(schema.aiSignals.kind, a.kind)];
      conditions.push(
        projectId === null
          ? sql`${schema.aiSignals.projectId} is null`
          : eq(schema.aiSignals.projectId, projectId),
      );
      const [row] = await ctx.db
        .select()
        .from(schema.aiSignals)
        .where(and(...conditions))
        .orderBy(sql`${schema.aiSignals.generatedAt} desc`)
        .limit(1);
      return row ?? { message: "No signal has been generated yet." };
    },
  }),

  defineTool({
    name: "list_waitlist",
    toolkit: "growth",
    description: "This property's waitlist, ranked by signup order boosted by how many people they referred.",
    input: z.object({ project: z.string(), limit: z.number().int().min(1).max(100).default(30) }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Waitlist for ${a.project}`,
    execute: async (ctx, a) => {
      const project = requireProject(ctx, a.project);

      const referralCounts = ctx.db
        .select({
          referredByCode: schema.waitlistEntries.referredByCode,
          count: sql<number>`count(*)::int`.as("referral_count"),
        })
        .from(schema.waitlistEntries)
        .where(
          and(
            eq(schema.waitlistEntries.projectId, project.id),
            isNotNull(schema.waitlistEntries.referredByCode),
          ),
        )
        .groupBy(schema.waitlistEntries.referredByCode)
        .as("referral_counts");

      const rows = await ctx.db
        .select({
          email: schema.waitlistEntries.email,
          name: schema.waitlistEntries.name,
          referralCode: schema.waitlistEntries.referralCode,
          createdAt: schema.waitlistEntries.createdAt,
          baseRank: sql<number>`count(*) over (order by ${schema.waitlistEntries.createdAt})::int`,
          referralCount: sql<number>`coalesce(${referralCounts.count}, 0)::int`,
        })
        .from(schema.waitlistEntries)
        .leftJoin(
          referralCounts,
          eq(referralCounts.referredByCode, schema.waitlistEntries.referralCode),
        )
        .where(eq(schema.waitlistEntries.projectId, project.id));

      return rows
        .map((row) => ({
          email: row.email,
          name: row.name,
          referralCount: row.referralCount,
          position: Math.max(1, row.baseRank - REFERRAL_BOOST * row.referralCount),
          createdAt: row.createdAt,
        }))
        .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
        .slice(0, a.limit);
    },
  }),
];
