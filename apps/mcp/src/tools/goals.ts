import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@falorb/db";
import {
  RANGE_DESCRIPTION,
  attribution,
  goalConversions,
  parseRange,
  type GoalDefinition,
} from "@falorb/queries";
import type { McpContext } from "../context";
import { requireScope, resolveProjects } from "../context";
import { failure, money, num, pct, table, text } from "../format";

/**
 * Conversion goals.
 *
 * A goal is a definition only — matched by event name or URL path pattern —
 * never a stored result, so evaluating it always reflects current data. The
 * definition lives in Postgres (`schema.goals`); evaluating it runs against
 * ClickHouse via `goalConversions`/`attribution`, same split as everywhere
 * else in this server.
 */
export function registerGoalTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_goals",
    {
      title: "List conversion goals",
      description: "Show configured goals for a project — what each matches, and whether it's active.",
      inputSchema: { project: z.string().describe("Project slug.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const rows = await db
          .select()
          .from(schema.goals)
          .where(eq(schema.goals.projectId, id!))
          .orderBy(asc(schema.goals.createdAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Name", get: (r) => r.name },
              { header: "Kind", get: (r) => r.kind },
              { header: "Matches", get: (r) => r.matcher },
              { header: "Value", get: (r) => (r.value ? `${r.value} ${r.currency}` : "—") },
              { header: "Active", get: (r) => (r.active ? "yes" : "no") },
            ],
            "No goals configured — create one with create_goal.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_goal",
    {
      title: "Create a conversion goal",
      description:
        "Define a conversion to track: an event name, or a URL path (optionally ending in * for a prefix match). Requires the write scope.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        name: z.string().min(1).max(120).describe("What it means, e.g. \"Signed up\" — not what it matches."),
        kind: z.enum(["event", "path"]).default("event"),
        matcher: z
          .string()
          .min(1)
          .describe('Event name for kind=event, or a URL path for kind=path (e.g. "/thank-you" or "/blog/*").'),
        value: z
          .number()
          .min(0)
          .optional()
          .describe("Assumed currency value per conversion when the event carries no explicit revenue."),
        currency: z.string().length(3).optional().default("USD"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project, name, kind, matcher, value, currency }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);

        const [created] = await db
          .insert(schema.goals)
          .values({
            projectId: id!,
            name,
            kind,
            matcher,
            value: value !== undefined ? value.toFixed(4) : null,
            currency,
          })
          .returning();

        return text(`Created goal **${created!.name}** (${created!.kind}: \`${created!.matcher}\`), id \`${created!.id}\`.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_goal_active",
    {
      title: "Pause or resume a goal",
      description: "Turn a goal on or off without deleting its definition. Requires the write scope.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        goal_id: z.string().describe("From list_goals."),
        active: z.boolean(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project, goal_id, active }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);

        const [updated] = await db
          .update(schema.goals)
          .set({ active })
          .where(and(eq(schema.goals.id, goal_id), eq(schema.goals.projectId, id!)))
          .returning();

        if (!updated) return failure("No such goal.");
        return text(`**${updated.name}** ${active ? "resumed" : "paused"}.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "delete_goal",
    {
      title: "Delete a conversion goal",
      description: "Permanently remove a goal definition. Requires the write scope.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        goal_id: z.string().describe("From list_goals."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ project, goal_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [id] = resolveProjects(scope, project);

        const [deleted] = await db
          .delete(schema.goals)
          .where(and(eq(schema.goals.id, goal_id), eq(schema.goals.projectId, id!)))
          .returning();

        if (!deleted) return failure("No such goal.");
        return text(`Deleted goal **${deleted.name}**.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_goal_conversions",
    {
      title: "Goal conversion rates",
      description:
        "Evaluate every active goal (or one goal) against live data: conversions, unique converters, conversion rate, and revenue.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        goal_id: z.string().optional().describe("Restrict to one goal; omit to evaluate every active goal."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, goal_id }) => {
      const { db, clickhouse, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const parsed = parseRange(range);

        const rows = await db
          .select()
          .from(schema.goals)
          .where(
            goal_id
              ? and(eq(schema.goals.id, goal_id), eq(schema.goals.projectId, id!))
              : and(eq(schema.goals.projectId, id!), eq(schema.goals.active, true)),
          );

        if (!rows.length) {
          return text(goal_id ? "No such goal." : "No active goals — create one with create_goal.");
        }

        const goals: GoalDefinition[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind as "event" | "path",
          matcher: r.matcher,
          value: r.value !== null ? Number(r.value) : null,
        }));

        const results = await goalConversions(clickhouse, { projectIds: [id!], range: parsed, goals });

        return text(
          `**Goal conversions — ${parsed.label}**\n\n` +
            table(results, [
              { header: "Goal", get: (r) => r.name },
              { header: "Conversions", get: (r) => num(r.conversions), align: "right" },
              { header: "Unique converters", get: (r) => num(r.uniqueConverters), align: "right" },
              { header: "Conversion rate", get: (r) => pct(r.conversionRate), align: "right" },
              { header: "Revenue", get: (r) => money(r.revenue), align: "right" },
            ]),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_goal_attribution",
    {
      title: "Revenue attribution for a goal",
      description:
        "Attribute a goal's conversions and revenue back to acquisition channel, under first_touch (credits discovery), last_touch (credits closing), or linear (splits credit across every channel that touched the converter) models. Reporting only one model tends to produce confidently wrong budget calls — check more than one before recommending a channel.",
      inputSchema: {
        project: z.string().describe("Project slug."),
        goal_id: z.string().describe("From list_goals."),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        model: z.enum(["first_touch", "last_touch", "linear"]).optional().default("last_touch"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, goal_id, range, model }) => {
      const { db, clickhouse, scope } = ctx();
      try {
        const [id] = resolveProjects(scope, project);
        const parsed = parseRange(range);

        const [goal] = await db
          .select()
          .from(schema.goals)
          .where(and(eq(schema.goals.id, goal_id), eq(schema.goals.projectId, id!)))
          .limit(1);
        if (!goal) return failure("No such goal.");

        const definition: GoalDefinition = {
          id: goal.id,
          name: goal.name,
          kind: goal.kind as "event" | "path",
          matcher: goal.matcher,
          value: goal.value !== null ? Number(goal.value) : null,
        };

        const rows = await attribution(clickhouse, { projectIds: [id!], range: parsed, goal: definition, model });

        return text(
          `**${goal.name} — attribution (${model}) — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "Channel", get: (r) => r.channel || "(none)" },
              { header: "Source", get: (r) => r.source || "(none)" },
              { header: "Conversions", get: (r) => num(r.conversions), align: "right" },
              { header: "Revenue", get: (r) => money(r.revenue), align: "right" },
              { header: "Share", get: (r) => pct(r.share), align: "right" },
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
