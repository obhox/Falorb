"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { DateRange } from "@falorb/queries";
import { requireProject } from "@/server/session";
import { breakdown, contentInterests, entryPages, exitPages } from "@/server/analytics";
import { hotLeads } from "@/server/sales";
import { listReferralLinks, referralLeaderboard } from "@/server/referrals";
import { AiSignalError, generateSignal } from "@/server/ai";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Generates and caches the Content page's AI recommendation.
 *
 * Re-runs the same queries the page itself renders, rather than trusting
 * whatever the client last saw — a stale or tampered client payload must
 * never end up quoted back as a "recommendation".  Rate-limited per project so
 * a double-click (or a script) cannot spend API budget in a loop.
 */
const MIN_REGENERATE_INTERVAL_MS = 5 * 60_000;

export async function regenerateContentSignal(
  slug: string,
  range: DateRange,
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(
    session.workspace.role,
    "writeAnalysis",
    "regenerate the content recommendation",
  );
  if (refusal) return refusal;

  const [existing] = await db()
    .select({ generatedAt: schema.aiSignals.generatedAt })
    .from(schema.aiSignals)
    .where(and(eq(schema.aiSignals.projectId, project.id), eq(schema.aiSignals.kind, "content")))
    .orderBy(desc(schema.aiSignals.generatedAt))
    .limit(1);

  if (existing && Date.now() - existing.generatedAt.getTime() < MIN_REGENERATE_INTERVAL_MS) {
    return { ok: false, message: "Just regenerated — try again in a few minutes." };
  }

  const scope = { projectIds: [project.id], range };
  const span = range.to - range.from;
  const previousRange: DateRange = { from: range.from - span, to: range.from };

  const [pages, entries, exits, interests, interestsPrevious] = await Promise.all([
    breakdown({ ...scope, field: "path", limit: 15 }),
    entryPages({ ...scope, limit: 10 }),
    exitPages({ ...scope, limit: 10, minPageviews: 10 }),
    contentInterests({ ...scope, limit: 15 }),
    contentInterests({ projectIds: [project.id], range: previousRange, limit: 15 }),
  ]);

  let body: string;
  try {
    body = await generateSignal("content", {
      dateRange: range,
      topPages: pages,
      entryPages: entries,
      exitPages: exits,
      interests,
      interestsPreviousPeriod: interestsPrevious,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AiSignalError ? error.message : "Could not generate a recommendation.",
    };
  }

  await db().insert(schema.aiSignals).values({
    organizationId: session.workspace.organizationId,
    projectId: project.id,
    kind: "content",
    body,
    basedOnRange: range,
  });

  revalidatePath(`/p/${slug}/signals`);
  return { ok: true, message: "Recommendation updated" };
}

/**
 * Generates and caches the Sales panel's recommendation, in one of two
 * independently-cached scopes (see `hotLeads` in `@/server/sales`):
 * "project" (`ai_signals.projectId = project.id`) and "portfolio"
 * (`projectId = null`, scoped by `organizationId` instead — mirrors
 * `dashboards`' own cross-project rows). Regenerating the portfolio scope
 * from any project's People page hits the same shared cooldown and produces
 * the same result everywhere, since it isn't actually about the one project
 * the reader happens to be viewing.
 */
export async function regenerateSalesSignal(
  slug: string,
  range: DateRange,
  scope: "project" | "portfolio",
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "regenerate the sales recommendation");
  if (refusal) return refusal;

  const cacheProjectId = scope === "project" ? project.id : null;

  const [existing] = await db()
    .select({ generatedAt: schema.aiSignals.generatedAt })
    .from(schema.aiSignals)
    .where(
      and(
        cacheProjectId == null
          ? isNull(schema.aiSignals.projectId)
          : eq(schema.aiSignals.projectId, cacheProjectId),
        eq(schema.aiSignals.kind, "sales"),
      ),
    )
    .orderBy(desc(schema.aiSignals.generatedAt))
    .limit(1);

  if (existing && Date.now() - existing.generatedAt.getTime() < MIN_REGENERATE_INTERVAL_MS) {
    return { ok: false, message: "Just regenerated — try again in a few minutes." };
  }

  const projectIds = scope === "project" ? [project.id] : session.projects.map((p) => p.id);
  const leads = await hotLeads(session.workspace.organizationId, scope, projectIds, range, 20);

  let body: string;
  try {
    body = await generateSignal("sales", {
      scope,
      dateRange: range,
      leads: leads.map((lead) => ({
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
      })),
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AiSignalError ? error.message : "Could not generate a recommendation.",
    };
  }

  await db().insert(schema.aiSignals).values({
    organizationId: session.workspace.organizationId,
    projectId: cacheProjectId,
    kind: "sales",
    body,
    basedOnRange: range,
  });

  revalidatePath(`/p/${slug}/signals`);
  return { ok: true, message: "Recommendation updated" };
}

/**
 * Generates and caches the Summary page's marketing recommendation, from the
 * same channel breakdown already rendered there plus the referral leaderboard.
 */
export async function regenerateMarketingSignal(slug: string, range: DateRange): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "regenerate the marketing recommendation");
  if (refusal) return refusal;

  const [existing] = await db()
    .select({ generatedAt: schema.aiSignals.generatedAt })
    .from(schema.aiSignals)
    .where(and(eq(schema.aiSignals.projectId, project.id), eq(schema.aiSignals.kind, "marketing")))
    .orderBy(desc(schema.aiSignals.generatedAt))
    .limit(1);

  if (existing && Date.now() - existing.generatedAt.getTime() < MIN_REGENERATE_INTERVAL_MS) {
    return { ok: false, message: "Just regenerated — try again in a few minutes." };
  }

  const scope = { projectIds: [project.id], range };
  const span = range.to - range.from;
  const previousRange: DateRange = { from: range.from - span, to: range.from };

  const [channels, channelsPrevious, links] = await Promise.all([
    breakdown({ ...scope, field: "channel", limit: 8, orderBy: "revenue" }),
    breakdown({ projectIds: [project.id], range: previousRange, field: "channel", limit: 8, orderBy: "revenue" }),
    listReferralLinks(project.id),
  ]);
  const referrals = await referralLeaderboard(project.id, range, links);

  let body: string;
  try {
    body = await generateSignal("marketing", {
      dateRange: range,
      channels,
      channelsPreviousPeriod: channelsPrevious,
      referralLinks: referrals.map((row) => ({
        label: row.link.label,
        clicks: row.clicks,
        visitors: row.visitors,
        conversions: row.conversions,
        conversionRate: row.conversionRate,
      })),
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AiSignalError ? error.message : "Could not generate a recommendation.",
    };
  }

  await db().insert(schema.aiSignals).values({
    organizationId: session.workspace.organizationId,
    projectId: project.id,
    kind: "marketing",
    body,
    basedOnRange: range,
  });

  revalidatePath(`/p/${slug}/signals`);
  return { ok: true, message: "Recommendation updated" };
}

/**
 * Generates and caches the Content page's product-gap recommendation.
 *
 * Reuses the exact same `contentInterests` fetch `regenerateContentSignal`
 * already makes — same data, a different system prompt (product-gap framing
 * rather than content-priority framing). There is no cross-funnel drop-off
 * query in this codebase yet (confirmed: `packages/queries/src/funnels.ts`
 * needs a caller-supplied funnel definition per call, nothing aggregates
 * across every stored funnel the way `goals.ts` does for goals) — v1
 * deliberately relies on the interest/coverage gap alone; cross-funnel
 * drop-off is a real fast-follow, not something to silently imply happened.
 */
export async function regenerateProductSignal(slug: string, range: DateRange): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "regenerate the product recommendation");
  if (refusal) return refusal;

  const [existing] = await db()
    .select({ generatedAt: schema.aiSignals.generatedAt })
    .from(schema.aiSignals)
    .where(and(eq(schema.aiSignals.projectId, project.id), eq(schema.aiSignals.kind, "product")))
    .orderBy(desc(schema.aiSignals.generatedAt))
    .limit(1);

  if (existing && Date.now() - existing.generatedAt.getTime() < MIN_REGENERATE_INTERVAL_MS) {
    return { ok: false, message: "Just regenerated — try again in a few minutes." };
  }

  const span = range.to - range.from;
  const previousRange: DateRange = { from: range.from - span, to: range.from };

  const [interests, interestsPrevious] = await Promise.all([
    contentInterests({ projectIds: [project.id], range, limit: 15 }),
    contentInterests({ projectIds: [project.id], range: previousRange, limit: 15 }),
  ]);

  let body: string;
  try {
    body = await generateSignal("product", {
      dateRange: range,
      interests,
      interestsPreviousPeriod: interestsPrevious,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof AiSignalError ? error.message : "Could not generate a recommendation.",
    };
  }

  await db().insert(schema.aiSignals).values({
    organizationId: session.workspace.organizationId,
    projectId: project.id,
    kind: "product",
    body,
    basedOnRange: range,
  });

  revalidatePath(`/p/${slug}/signals`);
  return { ok: true, message: "Recommendation updated" };
}
