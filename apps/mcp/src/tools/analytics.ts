import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  breakdown,
  entryPages,
  exitPages,
  frustration,
  pathTransitions,
  portfolioOverview,
  retention,
  stickiness,
  totals,
  trend,
  type Filter,
} from "@falorb/queries";
import type { McpContext } from "../context";
import { projectName, resolveProjects } from "../context";
import { parseRange, RANGE_DESCRIPTION } from "../range";
import { delta, duration, failure, money, num, pct, table, text } from "../format";

/** Shared filter argument. Kept loose here; the query layer validates strictly. */
const filtersArg = z
  .array(z.record(z.string(), z.unknown()))
  .optional()
  .describe(
    'Optional filters, e.g. [{"field":"country","op":"eq","value":"NG"}]. Call describe_filters for the full syntax.',
  );

const projectArg = z.string().optional().describe('Project slug, or "all" for the whole portfolio.');

export function registerAnalyticsTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "get_overview",
    {
      title: "Portfolio overview",
      description:
        "Headline metrics for every project side by side, with change against the previous equivalent period. The fastest way to answer 'how is everything doing'.",
      inputSchema: { range: z.string().optional().describe(RANGE_DESCRIPTION) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ range }) => {
      const { clickhouse, scope } = ctx();
      try {
        const parsed = parseRange(range);
        const rows = await portfolioOverview(clickhouse, {
          projectIds: scope.projectIds,
          range: parsed,
        });

        if (!rows.length) return text(`No traffic recorded in ${parsed.label}.`);

        const totalVisitors = rows.reduce((a, r) => a + Number(r.visitors), 0);
        const totalRevenue = rows.reduce((a, r) => a + Number(r.revenue), 0);

        return text(
          `**Portfolio — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "Project", get: (r) => projectName(scope, r.project_id) },
              { header: "Visitors", get: (r) => num(r.visitors), align: "right" },
              {
                header: "vs prev",
                get: (r) => delta(Number(r.visitors), Number(r.prev_visitors)),
                align: "right",
              },
              { header: "Sessions", get: (r) => num(r.sessions), align: "right" },
              { header: "Pageviews", get: (r) => num(r.pageviews), align: "right" },
              { header: "Revenue", get: (r) => money(r.revenue), align: "right" },
            ]) +
            `\n\n**Total:** ${num(totalVisitors)} visitors across ${rows.length} projects` +
            (totalRevenue ? `, ${money(totalRevenue)} revenue.` : "."),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_stats",
    {
      title: "Headline stats",
      description:
        "Core metrics for one project or the whole portfolio: visitors, sessions, pageviews, bounce rate, average session length, revenue.",
      inputSchema: {
        project: projectArg,
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        filters: filtersArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, filters }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const row = await totals(clickhouse, {
          projectIds,
          range: parsed,
          filters: filters as Filter[] | undefined,
        });

        return text(
          `**${project ?? "All projects"} — ${parsed.label}**\n\n` +
            table(
              [
                { k: "Visitors", v: num(row.visitors) },
                { k: "Sessions", v: num(row.sessions) },
                { k: "Pageviews", v: num(row.pageviews) },
                { k: "Events", v: num(row.events) },
                { k: "Bounce rate", v: pct(row.bounce_rate) },
                { k: "Avg session", v: duration(row.avg_session_sec) },
                { k: "Views / session", v: num(row.views_per_session) },
                { k: "Revenue", v: money(row.revenue) },
              ],
              [
                { header: "Metric", get: (r) => r.k },
                { header: "Value", get: (r) => r.v, align: "right" },
              ],
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_trend",
    {
      title: "Metric over time",
      description:
        "Time series for a metric, optionally split by a dimension. Use to answer 'is this growing' or 'which channel is driving growth'.",
      inputSchema: {
        project: projectArg,
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        metric: z
          .enum(["visitors", "sessions", "pageviews", "events", "revenue", "bounce_rate", "avg_duration"])
          .default("visitors"),
        interval: z.enum(["hour", "day", "week", "month"]).optional().describe("Defaults to a sensible bucket for the range."),
        breakdown: z
          .string()
          .optional()
          .describe('Split the series by a dimension, e.g. "channel", "country", "prop:plan".'),
        filters: filtersArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, metric, interval, breakdown: by, filters }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const points = await trend(clickhouse, {
          projectIds,
          range: parsed,
          metric,
          interval,
          breakdown: by,
          filters: filters as Filter[] | undefined,
        });

        if (!points.length) return text(`No data for ${metric} in ${parsed.label}.`);

        // Pivot into one row per bucket so a broken-down series reads as a
        // comparison rather than a long list of (bucket, series, value) triples.
        if (by) {
          const buckets = [...new Set(points.map((p) => p.bucket))].sort();
          const series = [...new Set(points.map((p) => p.series))];
          const lookup = new Map(points.map((p) => [`${p.bucket}|${p.series}`, p.value]));

          return text(
            `**${metric} by ${by} — ${parsed.label}**\n\n` +
              table(
                buckets.map((b) => ({ b })),
                [
                  { header: "Bucket", get: (r) => r.b.slice(0, 16) },
                  ...series.map((s) => ({
                    header: s || "(none)",
                    get: (r: { b: string }) => num(lookup.get(`${r.b}|${s}`) ?? 0),
                    align: "right" as const,
                  })),
                ],
              ),
          );
        }

        const values = points.map((p) => Number(p.value));
        const first = values[0] ?? 0;
        const last = values[values.length - 1] ?? 0;

        return text(
          `**${metric} — ${parsed.label}**\n\n` +
            table(points, [
              { header: "Bucket", get: (p) => p.bucket.slice(0, 16) },
              { header: metric, get: (p) => num(p.value), align: "right" },
            ]) +
            `\n\nTotal ${num(values.reduce((a, b) => a + b, 0))}, peak ${num(Math.max(...values))}, first→last ${delta(last, first)}.`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_breakdown",
    {
      title: "Top values for a dimension",
      description:
        "Rank any dimension by visitors: top pages, referrers, countries, browsers, campaigns, custom properties. This is the workhorse for 'what are my top X'.",
      inputSchema: {
        project: projectArg,
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        field: z
          .string()
          .describe('Dimension, e.g. "path", "source", "channel", "country", "device_type", "prop:plan".'),
        limit: z.number().int().min(1).max(500).optional().default(20),
        filters: filtersArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, field, limit, filters }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const rows = await breakdown(clickhouse, {
          projectIds,
          range: parsed,
          field,
          limit,
          filters: filters as Filter[] | undefined,
        });

        return text(
          `**Top ${field} — ${parsed.label}**\n\n` +
            table(rows, [
              { header: field, get: (r) => r.value || "(none)" },
              { header: "Visitors", get: (r) => num(r.visitors), align: "right" },
              { header: "Sessions", get: (r) => num(r.sessions), align: "right" },
              { header: "Pageviews", get: (r) => num(r.pageviews), align: "right" },
              { header: "Revenue", get: (r) => money(r.revenue), align: "right" },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_retention",
    {
      title: "Retention cohorts",
      description:
        "Cohort retention grid — of the people first seen in each period, what share came back in later periods. Answers whether the product is sticky.",
      inputSchema: {
        project: projectArg,
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        granularity: z.enum(["day", "week", "month"]).optional().default("week"),
        periods: z.number().int().min(2).max(24).optional().default(8),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, granularity, periods }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const rows = await retention(clickhouse, {
          projectIds,
          range: parsed,
          granularity,
          periods,
        });

        if (!rows.length) return text(`Not enough history for retention over ${parsed.label}.`);

        const columns = [
          { header: "Cohort", get: (r: (typeof rows)[number]) => r.cohort.slice(0, 10) },
          { header: "Size", get: (r: (typeof rows)[number]) => num(r.cohortSize), align: "right" as const },
          ...Array.from({ length: periods + 1 }, (_, i) => ({
            header: `+${i}`,
            get: (r: (typeof rows)[number]) =>
              r.percentages[i] === undefined || r.cohortSize === 0 ? "" : `${r.percentages[i]}%`,
            align: "right" as const,
          })),
        ];

        return text(
          `**Retention by ${granularity} — ${parsed.label}**\n\n` +
            table(rows, columns) +
            `\n\nEach column is periods since the cohort's first visit; +0 is always 100%.`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_stickiness",
    {
      title: "Stickiness",
      description:
        "Distribution of how many distinct days people were active — separates daily habits from one-off visits.",
      inputSchema: {
        project: projectArg,
        range: z.string().optional().describe(RANGE_DESCRIPTION),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const rows = await stickiness(clickhouse, { projectIds, range: parsed });
        const total = rows.reduce((a, r) => a + Number(r.people), 0);

        return text(
          `**Stickiness — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "Active days", get: (r) => r.active_days, align: "right" },
              { header: "People", get: (r) => num(r.people), align: "right" },
              {
                header: "Share",
                get: (r) => pct(total ? (Number(r.people) / total) * 100 : 0),
                align: "right",
              },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_dropoff",
    {
      title: "Where people leave",
      description:
        "Pages ranked by exit rate, plus landing pages and frustration signals (rage clicks, JS errors). Use this to find where a site is losing people. Exit rate is more useful than raw exits — a homepage tops the raw list simply by being the most viewed page.",
      inputSchema: {
        project: projectArg,
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        min_pageviews: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(10)
          .describe("Ignore pages below this many views; exit rate is meaningless on tiny samples."),
        limit: z.number().int().min(1).max(100).optional().default(15),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, min_pageviews, limit }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const opts = { projectIds, range: parsed, limit };

        const [exits, entries, pain] = await Promise.all([
          exitPages(clickhouse, { ...opts, minPageviews: min_pageviews }),
          entryPages(clickhouse, opts),
          frustration(clickhouse, opts),
        ]);

        return text(
          `**Drop-off — ${parsed.label}**\n\n` +
            `### Highest exit rate\n` +
            table(exits, [
              { header: "Page", get: (r) => r.path },
              { header: "Exit rate", get: (r) => pct(r.exit_rate), align: "right" },
              { header: "Exits", get: (r) => num(r.exits), align: "right" },
              { header: "Views", get: (r) => num(r.pageviews), align: "right" },
              { header: "Avg time", get: (r) => duration(r.avg_time_sec), align: "right" },
              { header: "Avg scroll", get: (r) => pct(r.avg_scroll, 0), align: "right" },
            ]) +
            `\n\n### Landing pages\n` +
            table(entries, [
              { header: "Page", get: (r) => r.path },
              { header: "Entries", get: (r) => num(r.entries), align: "right" },
              { header: "Bounce", get: (r) => pct(r.bounce_rate), align: "right" },
            ]) +
            `\n\n### Frustration signals\n` +
            table(
              pain,
              [
                { header: "Page", get: (r) => r.path },
                { header: "Rage clicks", get: (r) => num(r.rage_clicks), align: "right" },
                { header: "JS errors", get: (r) => num(r.errors), align: "right" },
                { header: "People hit", get: (r) => num(r.affected_visitors), align: "right" },
              ],
              "None detected.",
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_user_flows",
    {
      title: "Page-to-page flows",
      description:
        "Most common navigation paths between pages — the data behind a Sankey diagram. Shows the routes people actually take through the site.",
      inputSchema: {
        project: projectArg,
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        start_path: z.string().optional().describe("Only show flows leaving this path."),
        limit: z.number().int().min(1).max(200).optional().default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, start_path, limit }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const rows = await pathTransitions(clickhouse, {
          projectIds,
          range: parsed,
          limit,
          startPath: start_path,
        });

        return text(
          `**User flows — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "From", get: (r) => r.from_path },
              { header: "→ To", get: (r) => r.to_path },
              { header: "Transitions", get: (r) => num(r.transitions), align: "right" },
              { header: "People", get: (r) => num(r.visitors), align: "right" },
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
