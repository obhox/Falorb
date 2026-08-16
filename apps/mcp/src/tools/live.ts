import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { liveCounts, liveFeed, liveVisitors } from "@falorb/queries";
import type { McpContext } from "../context";
import { projectName, resolveProjects } from "../context";
import { ago, duration, failure, num, table, text } from "../format";

export function registerLiveTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "get_live_visitors",
    {
      title: "Who is on the site right now",
      description:
        "Visitors active in the last few minutes, with the page each is currently on. Also useful for confirming a tracker install is working — load the site and check the visit appears.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all".'),
        window_minutes: z.number().int().min(1).max(60).optional().default(5),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, window_minutes, limit }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const windowMs = window_minutes * 60_000;

        const [visitors, counts] = await Promise.all([
          liveVisitors(clickhouse, { projectIds, windowMs, limit }),
          liveCounts(clickhouse, { projectIds, windowMs }),
        ]);

        const summary = counts.length
          ? table(counts, [
              { header: "Project", get: (r) => projectName(scope, r.project_id) },
              { header: "Active now", get: (r) => num(r.visitors), align: "right" },
            ])
          : "Nobody active.";

        return text(
          `**Live — last ${window_minutes} minutes**\n\n` +
            summary +
            `\n\n### Current visitors\n` +
            table(
              visitors,
              [
                { header: "Person", get: (r) => r.person_id.slice(0, 8) },
                { header: "Project", get: (r) => projectName(scope, r.project_id) },
                { header: "On page", get: (r) => r.current_path },
                { header: "For", get: (r) => duration(r.seconds_on_site), align: "right" },
                { header: "Views", get: (r) => num(r.pageviews), align: "right" },
                { header: "Source", get: (r) => r.source },
                { header: "Location", get: (r) => [r.city, r.country].filter(Boolean).join(", ") },
                { header: "Device", get: (r) => `${r.device_type} · ${r.browser}` },
                { header: "Last seen", get: (r) => ago(r.last_seen) },
              ],
              "No visitors in this window.",
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_event_stream",
    {
      title: "Recent raw events",
      description:
        "The newest events as they arrived, including their custom properties. Use this to debug an integration or verify a newly added custom event is firing with the right payload.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all".'),
        window_minutes: z.number().int().min(1).max(1440).optional().default(30),
        limit: z.number().int().min(1).max(200).optional().default(40),
        include_bots: z.boolean().optional().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, window_minutes, limit, include_bots }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const rows = await liveFeed(clickhouse, {
          projectIds,
          since: Date.now() - window_minutes * 60_000,
          limit,
          includeBots: include_bots,
        });

        if (!rows.length) {
          return text(
            `No events in the last ${window_minutes} minutes. If you expected some, check the tracker snippet is installed and the project's allowed domains include the site's origin.`,
          );
        }

        return text(
          `**Event stream — last ${window_minutes} minutes**\n\n` +
            table(rows, [
              { header: "When", get: (r) => ago(r.timestamp) },
              { header: "Project", get: (r) => projectName(scope, r.project_id) },
              { header: "Event", get: (r) => r.name },
              { header: "Page", get: (r) => r.path },
              { header: "Person", get: (r) => r.person_id.slice(0, 8) },
              { header: "Country", get: (r) => r.country },
              { header: "Properties", get: (r) => (r.props_raw === "{}" ? "" : r.props_raw) },
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
