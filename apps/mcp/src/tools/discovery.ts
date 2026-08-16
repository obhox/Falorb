import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FILTERABLE_FIELDS } from "@falorb/queries";
import type { McpContext } from "../context";
import { resolveProjects } from "../context";
import { parseRange, RANGE_DESCRIPTION } from "../range";
import { failure, num, table, text } from "../format";

/**
 * Discovery tools.
 *
 * These matter more than they look. An assistant that cannot find out which
 * projects exist, what events are tracked, or which properties are available
 * will guess — and a guessed event name returns an empty result that reads
 * exactly like "nobody did this", which is a confidently wrong answer.
 *
 * Making the schema queryable turns that failure mode into a lookup.
 */
export function registerDiscoveryTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List every analytics project this API key can read, with its slug, domains and timezone. Call this first — every other tool takes a project slug.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { scope } = ctx();
      if (!scope.projects.length) return text("This API key has access to no projects.");

      return text(
        table(
          scope.projects,
          [
            { header: "Slug", get: (p) => p.slug },
            { header: "Name", get: (p) => p.name },
            { header: "Domains", get: (p) => p.domains.join(", ") },
            { header: "Timezone", get: (p) => p.timezone },
          ],
          "No projects.",
        ) +
          `\n\nPass a slug as \`project\`, or omit it (or use "all") to query the whole portfolio at once.`,
      );
    },
  );

  server.registerTool(
    "list_event_names",
    {
      title: "List tracked event names",
      description:
        "List the event names actually present in the data, with volume. Events prefixed with $ are captured automatically by the tracker; the rest are custom events the site sends. Use this before filtering or building a funnel so you reference names that exist.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all" for every project.'),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);

        const result = await clickhouse.query({
          query: `
            SELECT
                name,
                count()                   AS events,
                uniqCombined64(person_id) AS people,
                max(timestamp)            AS last_seen
            FROM events_v
            WHERE has({projectIds:Array(UInt32)}, project_id)
              AND timestamp >= {from:DateTime64(3)}
              AND timestamp < {to:DateTime64(3)}
              AND is_bot = 0
            GROUP BY name
            ORDER BY events DESC
            LIMIT 200
          `,
          query_params: {
            projectIds,
            from: chTime(parsed.from),
            to: chTime(parsed.to),
          },
          format: "JSONEachRow",
        });

        const rows = await result.json<{
          name: string;
          events: string;
          people: string;
          last_seen: string;
        }>();

        const auto = rows.filter((r) => r.name.startsWith("$"));
        const custom = rows.filter((r) => !r.name.startsWith("$"));

        const render = (list: typeof rows) =>
          table(list, [
            { header: "Event", get: (r) => r.name },
            { header: "Events", get: (r) => num(r.events), align: "right" },
            { header: "People", get: (r) => num(r.people), align: "right" },
            { header: "Last seen", get: (r) => r.last_seen },
          ]);

        return text(
          `Events in ${parsed.label}:\n\n` +
            `### Custom events\n${custom.length ? render(custom) : "None — the site is not sending any custom events yet."}\n\n` +
            `### Auto-captured\n${render(auto)}`,
        );
      } catch (error) {
        return failure(String(error instanceof Error ? error.message : error));
      }
    },
  );

  server.registerTool(
    "list_property_keys",
    {
      title: "List event property keys",
      description:
        "List the custom property keys present on events, split into string and numeric. Reference them in filters as `prop:<key>` for strings and `nprop:<key>` for numbers.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all".'),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        event: z.string().optional().describe("Only look at properties on this event name."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, event }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);
        const params: Record<string, unknown> = {
          projectIds,
          from: chTime(parsed.from),
          to: chTime(parsed.to),
        };
        let eventClause = "";
        if (event) {
          params.event = event;
          eventClause = "AND name = {event:String}";
        }

        const run = async (column: string) => {
          const result = await clickhouse.query({
            query: `
              SELECT key, count() AS uses
              FROM ${"events_v"}
              ARRAY JOIN mapKeys(${column}) AS key
              WHERE has({projectIds:Array(UInt32)}, project_id)
                AND timestamp >= {from:DateTime64(3)}
                AND timestamp < {to:DateTime64(3)}
                AND is_bot = 0
                ${eventClause}
              GROUP BY key
              ORDER BY uses DESC
              LIMIT 100
            `,
            query_params: params,
            format: "JSONEachRow",
          });
          return result.json<{ key: string; uses: string }>();
        };

        const [strings, numbers] = await Promise.all([run("props_str"), run("props_num")]);

        const render = (rows: Array<{ key: string; uses: string }>, prefix: string) =>
          table(rows, [
            { header: "Filter as", get: (r) => `${prefix}${r.key}` },
            { header: "Key", get: (r) => r.key },
            { header: "Uses", get: (r) => num(r.uses), align: "right" },
          ]);

        return text(
          `Properties in ${parsed.label}${event ? ` on \`${event}\`` : ""}:\n\n` +
            `### String properties\n${render(strings, "prop:")}\n\n` +
            `### Numeric properties\n${render(numbers, "nprop:")}`,
        );
      } catch (error) {
        return failure(String(error instanceof Error ? error.message : error));
      }
    },
  );

  server.registerTool(
    "describe_filters",
    {
      title: "Describe the filter syntax",
      description:
        "Explain the filter object accepted by the analytics tools: available fields, operators, and worked examples. Call this if a filter is rejected.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      text(
        [
          "Filters are objects combined into an array (AND-ed together).",
          "",
          "**Condition:** `{ \"field\": \"path\", \"op\": \"eq\", \"value\": \"/pricing\" }`",
          "",
          "**Groups:** `{ \"or\": [ ...conditions ] }`, `{ \"and\": [...] }`, `{ \"not\": {...} }`",
          "",
          "### Operators",
          "",
          table(
            [
              { op: "eq / neq", use: "exact match" },
              { op: "contains / not_contains", use: "case-insensitive substring" },
              { op: "starts_with / ends_with", use: "prefix or suffix" },
              { op: "gt / gte / lt / lte", use: "comparison (numeric fields)" },
              { op: "in / not_in", use: "value is an array, max 1000 entries" },
              { op: "is_set / is_not_set", use: "presence; omit `value`" },
            ],
            [
              { header: "Operator", get: (r) => r.op },
              { header: "Meaning", get: (r) => r.use },
            ],
          ),
          "",
          "### Fields",
          "",
          FILTERABLE_FIELDS.map((f) => `\`${f}\``).join(", "),
          "",
          "Plus custom properties: `prop:<key>` (string) and `nprop:<key>` (numeric).",
          "Use `list_property_keys` to see which exist.",
          "",
          "### Examples",
          "",
          "```json",
          JSON.stringify(
            [
              { field: "country", op: "in", value: ["NG", "GB"] },
              { field: "path", op: "starts_with", value: "/blog" },
              { field: "nprop:seats", op: "gte", value: 5 },
            ],
            null,
            2,
          ),
          "```",
        ].join("\n"),
      ),
  );
}

function chTime(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "");
}
