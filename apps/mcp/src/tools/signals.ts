import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, resolveAiCredentials } from "@falorb/db";
import { AiSignalError, generateSignal, type SignalKind } from "@falorb/ai";
import {
  RANGE_DESCRIPTION,
  breakdown,
  contentInterests,
  entryPages,
  exitPages,
  parseRange,
  topDropoffs,
  type DateRange,
} from "@falorb/queries";
import type { McpContext } from "../context";
import { requireCapability, requireScope, resolveProjects } from "../context";
import { ago, failure, text } from "../format";
import { hotLeads } from "./leads";

const KINDS = ["content", "sales", "marketing", "product"] as const;
const MIN_REGENERATE_INTERVAL_MS = 5 * 60_000;

/**
 * AI growth signals — cached recommendations, regenerated on demand.
 *
 * Mirrors `apps/web/src/server/actions/signals.ts`'s four regenerators:
 * same per-kind context (re-derived server-side, never trusted from a
 * caller), same 5-minute cooldown per cache key, same cache key convention
 * (`projectId = null` for the portfolio-wide "sales" scope). That file lives
 * inside the Next.js app, which this server does not depend on, so the
 * queries are re-run here rather than imported.
 */
export function registerSignalTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "get_latest_signal",
    {
      title: "Read the latest AI growth signal",
      description:
        "The most recently generated AI recommendation of one kind: 'content' (what to write next), 'sales' (who to contact), 'marketing' (which channel to lean into), 'product' (where the product loses people). Returns null if none has been generated yet — call regenerate_signal first.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe('Project slug. Omit only for kind="sales" with scope="portfolio".'),
        kind: z.enum(KINDS),
        scope: z
          .enum(["project", "portfolio"])
          .optional()
          .default("project")
          .describe('kind="sales" only: "project" (this property\'s leads) or "portfolio" (across every property).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, kind, scope: sigScope }) => {
      const { db, scope } = ctx();
      try {
        const isPortfolioSales = kind === "sales" && sigScope === "portfolio";
        if (!isPortfolioSales && !project) {
          return failure('project is required unless kind="sales" and scope="portfolio".');
        }
        const cacheProjectId = isPortfolioSales ? null : resolveProjects(scope, project)[0]!;

        const [row] = await db
          .select()
          .from(schema.aiSignals)
          .where(
            and(
              cacheProjectId == null ? isNull(schema.aiSignals.projectId) : eq(schema.aiSignals.projectId, cacheProjectId),
              eq(schema.aiSignals.kind, kind),
            ),
          )
          .orderBy(desc(schema.aiSignals.generatedAt))
          .limit(1);

        if (!row) return text(`No ${kind} signal generated yet. Call regenerate_signal.`);

        return text(`**${kind} signal** — generated ${ago(row.generatedAt.toISOString())}\n\n${row.body}`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "regenerate_signal",
    {
      title: "Regenerate an AI growth signal",
      description:
        "Re-run the analytics behind one growth signal and generate a fresh recommendation via LLM, caching it. Rate-limited to once per 5 minutes per project+kind (or per organization+kind for the sales/portfolio scope) — a recent regeneration returns an error asking to wait rather than spending API budget again. Requires the write scope.",
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe('Project slug. Required except for kind="sales" with scope="portfolio".'),
        kind: z.enum(KINDS),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        scope: z
          .enum(["project", "portfolio"])
          .optional()
          .default("project")
          .describe('kind="sales" only.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project, kind, range, scope: sigScope }) => {
      const { db, clickhouse, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "writeAnalysis", "regenerate a recommendation");

        const isPortfolioSales = kind === "sales" && sigScope === "portfolio";
        if (!isPortfolioSales && !project) {
          return failure('project is required unless kind="sales" and scope="portfolio".');
        }

        const parsed = parseRange(range ?? "30d");
        const dateRange: DateRange = { from: parsed.from, to: parsed.to };
        const previousRange: DateRange = { from: parsed.from - (parsed.to - parsed.from), to: parsed.from };

        const projectId = isPortfolioSales ? null : resolveProjects(scope, project)[0]!;

        const [existing] = await db
          .select({ generatedAt: schema.aiSignals.generatedAt })
          .from(schema.aiSignals)
          .where(
            and(
              projectId == null ? isNull(schema.aiSignals.projectId) : eq(schema.aiSignals.projectId, projectId),
              eq(schema.aiSignals.kind, kind),
            ),
          )
          .orderBy(desc(schema.aiSignals.generatedAt))
          .limit(1);

        if (existing && Date.now() - existing.generatedAt.getTime() < MIN_REGENERATE_INTERVAL_MS) {
          return failure("Just regenerated — try again in a few minutes.");
        }

        const projectRow = projectId != null ? scope.projects.find((p) => p.id === projectId) : undefined;
        let body: string;

        // The organization's own AI gateway and model when it has connected
        // one (see `resolveAiCredentials`), else the deployment's key.
        const credentials = await resolveAiCredentials(db, scope.organizationId, projectId ?? null);

        try {
          if (kind === "content") {
            const [pages, entries, exits, interests, interestsPrev] = await Promise.all([
              breakdown(clickhouse, { projectIds: [projectId!], range: dateRange, field: "path", limit: 15 }),
              entryPages(clickhouse, { projectIds: [projectId!], range: dateRange, limit: 10 }),
              exitPages(clickhouse, { projectIds: [projectId!], range: dateRange, limit: 10, minPageviews: 10 }),
              contentInterests(clickhouse, { projectIds: [projectId!], range: dateRange, limit: 15 }),
              contentInterests(clickhouse, { projectIds: [projectId!], range: previousRange, limit: 15 }),
            ]);
            body = await generateSignal("content" as SignalKind, {
              dateRange,
              topPages: pages,
              entryPages: entries,
              exitPages: exits,
              interests,
              interestsPreviousPeriod: interestsPrev,
            }, credentials);
          } else if (kind === "sales") {
            const projectIds = isPortfolioSales ? scope.projectIds : [projectId!];
            const leads = await hotLeads(
              db,
              clickhouse,
              scope.organizationId,
              isPortfolioSales ? "portfolio" : "project",
              projectIds,
              dateRange,
              20,
            );
            body = await generateSignal("sales" as SignalKind, {
              scope: isPortfolioSales ? "portfolio" : "project",
              dateRange,
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
            }, credentials);
          } else if (kind === "marketing") {
            const [channels, channelsPrev] = await Promise.all([
              breakdown(clickhouse, { projectIds: [projectId!], range: dateRange, field: "channel", limit: 8, orderBy: "revenue" }),
              breakdown(clickhouse, { projectIds: [projectId!], range: previousRange, field: "channel", limit: 8, orderBy: "revenue" }),
            ]);
            const links = await db
              .select()
              .from(schema.referralLinks)
              .where(eq(schema.referralLinks.projectId, projectId!));
            body = await generateSignal("marketing" as SignalKind, {
              dateRange,
              channels,
              channelsPreviousPeriod: channelsPrev,
              referralLinks: links.map((l) => ({ label: l.label, code: l.code })),
            }, credentials);
          } else {
            const [interests, interestsPrev, dropoffs] = await Promise.all([
              contentInterests(clickhouse, { projectIds: [projectId!], range: dateRange, limit: 15 }),
              contentInterests(clickhouse, { projectIds: [projectId!], range: previousRange, limit: 15 }),
              topDropoffs(clickhouse, { projectIds: [projectId!], range: dateRange, limit: 15 }),
            ]);
            body = await generateSignal("product" as SignalKind, {
              dateRange,
              interests,
              interestsPreviousPeriod: interestsPrev,
              dropoffs,
            }, credentials);
          }
        } catch (error) {
          return failure(error instanceof AiSignalError ? error.message : "Could not generate a recommendation.");
        }

        await db.insert(schema.aiSignals).values({
          organizationId: scope.organizationId,
          projectId,
          kind,
          body,
          basedOnRange: dateRange,
        });

        return text(
          `**${kind} signal**${projectRow ? ` for ${projectRow.name}` : " (portfolio)"} — regenerated:\n\n${body}`,
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
