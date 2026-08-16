import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { funnel, funnelDropoffs, type Filter, type FunnelStep } from "@falorb/queries";
import type { McpContext } from "../context";
import { resolveProjects } from "../context";
import { parseRange, RANGE_DESCRIPTION } from "../range";
import { ago, failure, num, pct, table, text } from "../format";

const stepSchema = z.object({
  label: z.string().describe("Human-readable name for this step."),
  event: z.string().optional().describe('Event name to match, e.g. "$pageview" or "signup".'),
  filters: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Extra conditions, e.g. [{"field":"path","op":"eq","value":"/pricing"}].'),
});

export function registerFunnelTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "run_funnel",
    {
      title: "Run a conversion funnel",
      description:
        "Measure how many people progress through an ordered sequence of steps, with the loss at each stage. Define steps ad hoc — nothing needs to be saved first. Each step is an event name and/or filters; a page-based step is `$pageview` plus a path filter.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all".'),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        steps: z.array(stepSchema).min(2).max(12).describe("Ordered funnel steps."),
        window_hours: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(168)
          .describe("How long someone has to complete the whole funnel. Default 168h (7 days)."),
        mode: z
          .enum(["ordered", "strict", "any"])
          .optional()
          .default("ordered")
          .describe(
            "ordered: steps in sequence, other events allowed between. strict: no other event between steps. any: order ignored.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, steps, window_hours, mode }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);

        const results = await funnel(clickhouse, {
          projectIds,
          range: parsed,
          steps: steps as FunnelStep[],
          windowHours: window_hours,
          mode,
        });

        const entered = results[0]?.reached ?? 0;
        if (!entered) {
          return text(
            `Nobody entered the funnel in ${parsed.label}. Check the first step matches a real event — use \`list_event_names\` to see what is actually tracked.`,
          );
        }

        const worst = results
          .slice(1)
          .reduce((a, b) => (b.dropOffRate > a.dropOffRate ? b : a), results[1]!);

        return text(
          `**Funnel — ${parsed.label}** (${window_hours}h window, ${mode})\n\n` +
            table(results, [
              { header: "#", get: (r) => r.step, align: "right" },
              { header: "Step", get: (r) => r.label },
              { header: "Reached", get: (r) => num(r.reached), align: "right" },
              { header: "% of start", get: (r) => pct(r.conversionFromStart), align: "right" },
              { header: "% of prev", get: (r) => pct(r.conversionFromPrevious), align: "right" },
              { header: "Lost here", get: (r) => (r.step === 1 ? "—" : num(r.droppedOff)), align: "right" },
            ]) +
            `\n\n**Overall conversion:** ${pct(results[results.length - 1]!.conversionFromStart)} ` +
            `(${num(results[results.length - 1]!.reached)} of ${num(entered)}).\n` +
            `**Biggest loss:** step ${worst.step} "${worst.label}" — ${pct(worst.dropOffRate)} of those who reached the previous step dropped.\n\n` +
            `Use \`get_funnel_dropoffs\` with \`at_step: ${worst.step - 1}\` to see who abandoned there.`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_funnel_dropoffs",
    {
      title: "Who abandoned a funnel",
      description:
        "List the individual people who reached a given funnel step and went no further. Turns a drop-off percentage into named profiles you can inspect with get_person.",
      inputSchema: {
        project: z.string().optional().describe('Project slug, or "all".'),
        range: z.string().optional().describe(RANGE_DESCRIPTION),
        steps: z.array(stepSchema).min(2).max(12).describe("The same steps used for the funnel."),
        at_step: z
          .number()
          .int()
          .min(1)
          .describe("Step number people reached but did not pass (1-indexed)."),
        window_hours: z.number().int().min(1).optional().default(168),
        limit: z.number().int().min(1).max(500).optional().default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, range, steps, at_step, window_hours, limit }) => {
      const { clickhouse, scope } = ctx();
      try {
        const projectIds = resolveProjects(scope, project);
        const parsed = parseRange(range);

        const rows = await funnelDropoffs(clickhouse, {
          projectIds,
          range: parsed,
          steps: steps as FunnelStep[],
          windowHours: window_hours,
          atStep: at_step,
          limit,
        });

        if (!rows.length) {
          return text(`Nobody stopped exactly at step ${at_step} in ${parsed.label}.`);
        }

        return text(
          `**Dropped at step ${at_step} (${steps[at_step - 1]?.label ?? "?"}) — ${parsed.label}**\n\n` +
            table(rows, [
              { header: "Person", get: (r) => r.person_id.slice(0, 8) },
              { header: "Last page", get: (r) => r.last_path },
              { header: "Last seen", get: (r) => ago(r.last_seen) },
              { header: "Source", get: (r) => r.source },
              { header: "Country", get: (r) => r.country },
              { header: "Device", get: (r) => r.device_type },
              { header: "Events", get: (r) => num(r.events), align: "right" },
            ]) +
            `\n\nPass a full person id to \`get_person\` for the complete history.`,
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
