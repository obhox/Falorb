import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@falorb/db";
import type { McpContext } from "../context";
import { requireScope, resolveProjects } from "../context";
import { ago, failure, num, table, text } from "../format";

/**
 * Configuration tools.
 *
 * Two deliberate boundaries here.
 *
 * Writes require the `write` scope, so a read-only key handed to an assistant
 * cannot change anything.
 *
 * Destructive operations are **not exposed at all** — no project deletion, no
 * person erasure, no data purge. Those are irreversible, and an assistant
 * acting on a misread instruction should not be able to reach them. Erasure in
 * particular is a GDPR obligation that needs a human to confirm the subject's
 * identity, so it stays a dashboard action.
 */
export function registerManagementTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_alerts",
    {
      title: "List alert rules",
      description: "Show configured alert rules and when each last fired.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.alerts)
          .where(eq(schema.alerts.organizationId, scope.organizationId))
          .orderBy(desc(schema.alerts.createdAt));

        return text(
          table(
            rows,
            [
              { header: "Name", get: (r) => r.name },
              { header: "Kind", get: (r) => r.kind },
              { header: "Active", get: (r) => (r.active ? "yes" : "no") },
              { header: "Condition", get: (r) => JSON.stringify(r.condition) },
              { header: "Last fired", get: (r) => ago(r.lastFiredAt?.toISOString()) },
            ],
            "No alert rules configured.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_alert",
    {
      title: "Create an alert rule",
      description:
        "Create a monitoring rule. `no_data` catches a broken or blocked tracker — the failure every other alert misses, because a dead tracker produces nothing to threshold. `anomaly` compares against the same window a week earlier, which avoids firing on normal weekday/weekend shape. Requires the write scope.",
      inputSchema: {
        name: z.string().min(1).max(120),
        project: z.string().optional().describe("Project slug; omit to watch all projects."),
        kind: z.enum(["threshold", "anomaly", "no_data", "error_spike"]),
        metric: z
          .enum(["visitors", "sessions", "pageviews", "events", "revenue"])
          .optional()
          .describe("Required for threshold and anomaly."),
        operator: z.enum(["lt", "lte", "gt", "gte"]).optional().describe("Required for threshold."),
        value: z.number().optional().describe("Threshold value, or error count for error_spike."),
        change_percent: z.number().optional().describe("For anomaly: percentage change that counts."),
        direction: z.enum(["drop", "rise", "either"]).optional().default("either"),
        window_minutes: z.number().int().min(5).max(10080).optional().default(60),
        cooldown_minutes: z.number().int().min(5).optional().default(60),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const projectIds = args.project ? resolveProjects(scope, args.project) : [];
        const condition: Record<string, unknown> = { windowMinutes: args.window_minutes };

        if (args.kind === "threshold") {
          if (!args.metric || !args.operator || args.value === undefined) {
            return failure("threshold alerts need metric, operator and value.");
          }
          Object.assign(condition, {
            metric: args.metric,
            operator: args.operator,
            value: args.value,
          });
        } else if (args.kind === "anomaly") {
          if (!args.metric || args.change_percent === undefined) {
            return failure("anomaly alerts need metric and change_percent.");
          }
          Object.assign(condition, {
            metric: args.metric,
            changePercent: args.change_percent,
            direction: args.direction,
          });
        } else if (args.kind === "error_spike") {
          condition.value = args.value ?? 25;
        }

        const [created] = await db
          .insert(schema.alerts)
          .values({
            organizationId: scope.organizationId,
            projectId: projectIds[0] ?? null,
            name: args.name,
            kind: args.kind,
            condition,
            cooldownMinutes: args.cooldown_minutes,
          })
          .returning();

        return text(
          `Created alert **${created!.name}** (${created!.kind}).\n\n` +
            `Condition: \`${JSON.stringify(condition)}\`\n` +
            `Evaluated every 5 minutes by the worker, with a ${args.cooldown_minutes}-minute cooldown between notifications.\n\n` +
            `It has no delivery channel yet, so firings are recorded and logged but not sent anywhere.`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_install_snippet",
    {
      title: "Tracker install snippet",
      description:
        "The exact HTML snippet to install on a project's site, plus the JavaScript API for identifying users and tracking custom events.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const [row] = await db
          .select()
          .from(schema.projects)
          .where(and(eq(schema.projects.id, id!), eq(schema.projects.organizationId, scope.organizationId)))
          .limit(1);

        if (!row) return failure(`Project "${project}" not found.`);

        const host = process.env.FALORB_INGEST_URL ?? "https://a.example.com";

        return text(
          `**Install snippet for ${row.name}**\n\n` +
            "```html\n" +
            `<script defer src="${host}/t.js" data-project="${row.publicKey}"></script>\n` +
            "```\n\n" +
            `Allowed domains: ${row.domains.length ? row.domains.join(", ") : "any (none configured yet)"}\n\n` +
            "### Identifying users\n\n" +
            "```js\n" +
            "falorb.identify(user.id, { email: user.email, plan: user.plan })\n" +
            "```\n\n" +
            "Calling `identify()` with the same id on two of your projects is what unifies a person across them — it is the only mechanism that does, so wire it into each product's login.\n\n" +
            "### Custom events and revenue\n\n" +
            "```js\n" +
            "falorb.track('checkout_started', { plan: 'pro', seats: 3 })\n" +
            "falorb.revenue(99, 'USD')\n" +
            "```\n\n" +
            "The public key above is safe to expose — it ships in your page source. Requests are authorised by Origin against the allowed domains.",
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_platform_health",
    {
      title: "Platform health",
      description:
        "Ingest and pipeline health: events received recently per project, bot share, and whether any project has gone quiet. Use this when numbers look wrong before concluding traffic actually dropped.",
      inputSchema: { window_hours: z.number().int().min(1).max(168).optional().default(24) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ window_hours }) => {
      const { clickhouse, scope } = ctx();
      try {
        const since = new Date(Date.now() - window_hours * 3_600_000)
          .toISOString()
          .replace("T", " ")
          .replace("Z", "");

        const result = await clickhouse.query({
          query: `
            SELECT
                project_id,
                count()                       AS events,
                countIf(is_bot = 1)           AS bot_events,
                uniqCombined64(person_id)     AS people,
                max(timestamp)                AS last_event,
                max(ingested_at)              AS last_ingest
            FROM events
            WHERE has({projectIds:Array(UInt32)}, project_id)
              AND timestamp >= {since:DateTime64(3)}
            GROUP BY project_id
          `,
          query_params: { projectIds: scope.projectIds, since },
          format: "JSONEachRow",
        });

        const rows = await result.json<{
          project_id: number;
          events: string;
          bot_events: string;
          people: string;
          last_event: string;
          last_ingest: string;
        }>();

        const reporting = new Set(rows.map((r) => r.project_id));
        const silent = scope.projects.filter((p) => !reporting.has(p.id));

        return text(
          `**Pipeline health — last ${window_hours}h**\n\n` +
            table(
              rows,
              [
                { header: "Project", get: (r) => scope.projects.find((p) => p.id === r.project_id)?.slug ?? r.project_id },
                { header: "Events", get: (r) => num(r.events), align: "right" },
                { header: "People", get: (r) => num(r.people), align: "right" },
                {
                  header: "Bot share",
                  get: (r) =>
                    `${((Number(r.bot_events) / Math.max(Number(r.events), 1)) * 100).toFixed(1)}%`,
                  align: "right",
                },
                { header: "Last event", get: (r) => ago(r.last_event) },
              ],
              "No project reported any events.",
            ) +
            (silent.length
              ? `\n\n⚠️ **Silent projects:** ${silent.map((p) => p.slug).join(", ")} — no events at all in this window. Either they get no traffic, the snippet is missing, or an ad blocker is stopping it.`
              : `\n\nAll ${scope.projects.length} projects are reporting.`),
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
