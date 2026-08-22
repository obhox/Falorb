import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../context";
import { resolveProjects } from "../context";
import { resolveOpenSeoClient } from "../integrations";
import { failure, num, table, text } from "../format";

/**
 * Live SEO monitoring via OpenSEO — mirrors `@/server/seo` in the web app
 * (domain overview, ranking keywords, backlinks, rank tracker, Search
 * Console performance), re-derived here rather than imported since this
 * server does not depend on the Next.js app. Not mirrored into Postgres:
 * see `packages/openseo-client`'s doc comment for why this integration has
 * no sync job.
 */
export function registerSeoTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "get_seo_report",
    {
      title: "Get a project's live SEO report",
      description:
        "Domain overview, top ranking keywords, backlinks, rank-tracker movement, and Search Console performance for a project's domain, read live from OpenSEO. Requires OpenSEO to be connected (Settings → Integrations, org-level or for this project); returns a clear message if it isn't.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const row = scope.projects.find((p) => p.id === id)!;
        const domain = row.domains[0];
        if (!domain) return failure(`${row.name} has no domain set — add one before checking SEO data.`);

        const client = await resolveOpenSeoClient(db, scope.organizationId, id!);
        if (!client) {
          return failure("OpenSEO isn't connected. Connect it under Settings → Integrations, then try again.");
        }

        const [overview, keywords, backlinks, rankTracker] = await Promise.all([
          client.getDomainOverview(domain).catch(() => null),
          client.getDomainKeywords(domain, { limit: 15 }).catch(() => []),
          client.getBacklinksOverview(domain).catch(() => null),
          client.getRankTracker(domain).catch(() => []),
        ]);

        const summary =
          `**${domain}** — ${overview?.organicTraffic != null ? num(overview.organicTraffic) : "unknown"} organic traffic, ` +
          `${overview?.organicKeywords != null ? num(overview.organicKeywords) : "unknown"} organic keywords, ` +
          `${backlinks?.referringDomains != null ? num(backlinks.referringDomains) : "unknown"} referring domains, ` +
          `${backlinks?.totalBacklinks != null ? num(backlinks.totalBacklinks) : "unknown"} backlinks.`;

        const keywordsTable = table(
          keywords,
          [
            { header: "Keyword", get: (k) => k.keyword },
            { header: "Position", get: (k) => (k.position != null ? num(k.position) : "—") },
            { header: "Volume", get: (k) => (k.volume != null ? num(k.volume) : "—") },
          ],
          "No ranking keywords found.",
        );

        const rankTrackerTable = table(
          rankTracker,
          [
            { header: "Keyword", get: (r) => r.keyword },
            { header: "Position", get: (r) => (r.position != null ? num(r.position) : "—") },
            { header: "Previous", get: (r) => (r.previousPosition != null ? num(r.previousPosition) : "—") },
          ],
          "No keywords in the rank tracker.",
        );

        return text(
          `${summary}\n\n**Ranking keywords**\n\n${keywordsTable}\n\n**Rank tracker**\n\n${rankTrackerTable}`,
        );
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
