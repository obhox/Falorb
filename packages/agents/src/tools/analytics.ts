import { z } from "zod";
import {
  breakdown,
  funnel,
  parseRange,
  retention,
  topDropoffs,
  totals,
  trend,
  RANGE_DESCRIPTION,
} from "@falorb/queries";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * What the properties are doing.
 *
 * Every tool here reads through `@falorb/queries`, the same layer the
 * dashboard and the MCP server read through — so an agent's numbers and the
 * numbers on screen come from one implementation. An agent computing its own
 * aggregates would eventually report a figure a human could not reproduce,
 * and "the AI says 12% but the dashboard says 9%" destroys confidence in
 * both faster than any wrong recommendation would.
 *
 * `project` is a slug, never an id, and is resolved against the agent's own
 * allowed set. An id the model invented must never reach a query.
 */

function resolveScope(ctx: AgentContext, project: string | undefined): number[] {
  if (!project || project.toLowerCase() === "all") return ctx.projectIds;
  const wanted = project.toLowerCase();
  const match = ctx.projects.find((p) => p.slug.toLowerCase() === wanted);
  if (!match) {
    throw new Error(
      `Unknown property "${project}". You can see: ${ctx.projects.map((p) => p.slug).join(", ")}.`,
    );
  }
  return [match.id];
}

const projectArg = z
  .string()
  .optional()
  .describe('Property slug, or "all" for the whole portfolio. Defaults to all.');

const rangeArg = z.string().optional().describe(RANGE_DESCRIPTION);

export const analyticsTools: AnyToolDefinition[] = [
  defineTool({
    name: "list_properties",
    toolkit: "analytics",
    description:
      "List the properties (websites and products) this agent can see, with their slugs. " +
      "Call this first when unsure which slug to pass to another tool.",
    input: z.object({}),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: () => "List properties",
    execute: async (ctx) =>
      ctx.projects.map((p) => ({ slug: p.slug, name: p.name, domains: p.domains })),
  }),

  defineTool({
    name: "get_stats",
    toolkit: "analytics",
    description:
      "Headline numbers for one property or the whole portfolio over a date range: visitors, " +
      "sessions, pageviews, revenue, bounce rate, session length. The starting point for " +
      "almost any question about how something is performing.",
    input: z.object({ project: projectArg, range: rangeArg }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Stats for ${a.project ?? "all properties"} over ${a.range ?? "30d"}`,
    execute: async (ctx, a) => {
      const range = parseRange(a.range);
      const row = await totals(ctx.clickhouse, { projectIds: resolveScope(ctx, a.project), range });
      return { range: range.label, ...row };
    },
  }),

  defineTool({
    name: "get_trend",
    toolkit: "analytics",
    description:
      "A metric over time, optionally split by a dimension. Use this to establish whether " +
      "something is rising or falling, rather than inferring a direction from one total.",
    input: z.object({
      project: projectArg,
      range: rangeArg,
      metric: z
        .enum(["visitors", "sessions", "pageviews", "events", "revenue", "bounce_rate"])
        .default("visitors"),
      breakdown: z
        .string()
        .optional()
        .describe('Dimension to split by, e.g. "channel", "source", "country", "device".'),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Trend of ${a.metric} for ${a.project ?? "all properties"}`,
    execute: async (ctx, a) =>
      trend(ctx.clickhouse, {
        projectIds: resolveScope(ctx, a.project),
        range: parseRange(a.range),
        metric: a.metric,
        ...(a.breakdown ? { breakdown: a.breakdown } : {}),
      }),
  }),

  defineTool({
    name: "get_breakdown",
    toolkit: "analytics",
    description:
      "Top values of a dimension — pages, referrers, channels, countries, devices, campaigns — " +
      "ranked by visitors. How to find where traffic comes from, or what people actually read.",
    input: z.object({
      project: projectArg,
      range: rangeArg,
      field: z
        .string()
        .describe(
          'Dimension, e.g. "path", "referrer", "channel", "source", "country", "device", "utm_campaign".',
        ),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Top ${a.field} for ${a.project ?? "all properties"}`,
    execute: async (ctx, a) =>
      breakdown(ctx.clickhouse, {
        projectIds: resolveScope(ctx, a.project),
        range: parseRange(a.range),
        field: a.field,
        limit: a.limit,
      }),
  }),

  defineTool({
    name: "run_funnel",
    toolkit: "analytics",
    description:
      "Measure how many people get through an ordered sequence of steps, and where they fall " +
      "out. Each step matches an event name. Confirm the event exists first — a name nothing " +
      "emits returns zero, which reads identically to nobody doing it.",
    input: z.object({
      project: projectArg,
      range: rangeArg,
      steps: z
        .array(z.object({ label: z.string(), event: z.string() }))
        .min(2)
        .max(8)
        .describe(
          "Ordered steps, e.g. [{label:'Landed',event:'$pageview'},{label:'Signed up',event:'signup'}].",
        ),
      windowHours: z.number().int().min(1).max(720).default(168),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Funnel: ${a.steps.map((s) => s.label).join(" → ")}`,
    execute: async (ctx, a) =>
      funnel(ctx.clickhouse, {
        projectIds: resolveScope(ctx, a.project),
        range: parseRange(a.range),
        steps: a.steps,
        windowHours: a.windowHours,
      }),
  }),

  defineTool({
    name: "get_dropoff",
    toolkit: "analytics",
    description:
      "Pages ranked by exit *rate* — where the experience is losing people. Prefer this over " +
      "raw exit counts, which mostly rank pages by how popular they already are.",
    input: z.object({
      project: projectArg,
      range: rangeArg,
      limit: z.number().int().min(1).max(50).default(15),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Drop-off pages for ${a.project ?? "all properties"}`,
    execute: async (ctx, a) =>
      topDropoffs(ctx.clickhouse, {
        projectIds: resolveScope(ctx, a.project),
        range: parseRange(a.range),
        limit: a.limit,
      }),
  }),

  defineTool({
    name: "get_retention",
    toolkit: "analytics",
    description:
      "Whether people come back, as cohorts by the period they were first seen. Answers " +
      "'is this growing, or just churning through new visitors'.",
    input: z.object({
      project: projectArg,
      range: rangeArg,
      granularity: z.enum(["day", "week", "month"]).default("week"),
      periods: z.number().int().min(2).max(12).default(8),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Retention for ${a.project ?? "all properties"}`,
    execute: async (ctx, a) =>
      retention(ctx.clickhouse, {
        projectIds: resolveScope(ctx, a.project),
        range: parseRange(a.range),
        granularity: a.granularity,
        periods: a.periods,
      }),
  }),
];
