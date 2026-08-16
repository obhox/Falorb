import type { ClickHouseClient } from "@clickhouse/client";
import { EVENTS, clampLimit, runQuery, scopeClause, type BuiltQuery, type QueryScope } from "./base";
import { compileFilters, type Filter } from "./filters";

/**
 * Funnels via ClickHouse's `windowFunnel`, which computes how far each person
 * progressed through an ordered sequence in a single pass over their events.
 * The alternative — self-joining the events table once per step — is
 * quadratic and unusable past a few million rows.
 */

export interface FunnelStep {
  label: string;
  /** Event name to match, e.g. "$pageview" or "signup". */
  event?: string;
  /** Additional conditions the matching event must satisfy. */
  filters?: Filter[];
}

export interface FunnelOptions extends QueryScope {
  steps: FunnelStep[];
  /** How long a person has to complete the whole sequence. */
  windowHours?: number;
  /**
   * "ordered"  — steps must occur in the given order (default)
   * "strict"   — no other tracked event may occur between two steps
   * "any"      — steps may be completed in any order
   */
  mode?: "ordered" | "strict" | "any";
  /** Split the funnel by a dimension, e.g. compare channels. */
  breakdown?: string;
}

export interface FunnelStepResult {
  step: number;
  label: string;
  reached: number;
  /** Share of everyone who entered the funnel. */
  conversionFromStart: number;
  /** Share of those who reached the previous step. */
  conversionFromPrevious: number;
  /** People lost between the previous step and this one. */
  droppedOff: number;
  dropOffRate: number;
}

export class FunnelError extends Error {}

/**
 * Compile one step into a boolean condition.
 *
 * Each step gets its own parameter prefix so that two steps filtering on the
 * same field cannot collide on a parameter name.
 */
function stepCondition(
  step: FunnelStep,
  index: number,
  params: Record<string, unknown>,
): string {
  const parts: string[] = [];

  if (step.event) {
    const name = `se${index}`;
    params[name] = step.event;
    parts.push(`name = {${name}:String}`);
  }

  if (step.filters?.length) {
    const compiled = compileFilters(step.filters, `s${index}f`);
    parts.push(compiled.sql);
    Object.assign(params, compiled.params);
  }

  if (!parts.length) throw new FunnelError(`step ${index + 1} has no event and no filters`);
  return parts.join(" AND ");
}

export function buildFunnel(options: FunnelOptions): BuiltQuery {
  if (options.steps.length < 2) throw new FunnelError("a funnel needs at least two steps");
  if (options.steps.length > 12) throw new FunnelError("a funnel is limited to 12 steps");

  const scope = scopeClause(options);
  const params: Record<string, unknown> = { ...scope.params };
  const conditions = options.steps.map((s, i) => stepCondition(s, i, params));

  const windowSeconds = Math.max(60, Math.round((options.windowHours ?? 168) * 3600));
  params.windowSeconds = windowSeconds;

  const modeArg =
    options.mode === "strict" ? ", 'strict_order'" : options.mode === "any" ? ", 'strict_deduplication'" : "";

  // toDateTime(), not the raw column: windowFunnel rejects DateTime64 outright
  // with ILLEGAL_TYPE_OF_ARGUMENT.
  const levels = `
      SELECT
          person_id,
          windowFunnel({windowSeconds:UInt32}${modeArg})(
              toDateTime(timestamp),
              ${conditions.join(",\n              ")}
          ) AS level
      FROM ${EVENTS}
      WHERE ${scope.sql}
      GROUP BY person_id
  `;

  // One row per step, each counting everyone who got at least that far.
  const stepSelects = options.steps
    .map((_, i) => `SELECT ${i + 1} AS step, countIf(level >= ${i + 1}) AS reached FROM levels`)
    .join("\n        UNION ALL\n        ");

  return {
    sql: `
      WITH levels AS (${levels})
      SELECT step, reached
      FROM (
        ${stepSelects}
      )
      ORDER BY step
    `,
    params,
  };
}

export async function funnel(
  client: ClickHouseClient,
  options: FunnelOptions,
): Promise<FunnelStepResult[]> {
  const rows = await runQuery<{ step: number; reached: string | number }>(
    client,
    buildFunnel(options),
  );

  const counts = rows
    .sort((a, b) => a.step - b.step)
    .map((r) => Number(r.reached));

  const entered = counts[0] ?? 0;

  return options.steps.map((step, i) => {
    const reached = counts[i] ?? 0;
    const previous = i === 0 ? reached : (counts[i - 1] ?? 0);
    const dropped = i === 0 ? 0 : previous - reached;

    return {
      step: i + 1,
      label: step.label,
      reached,
      conversionFromStart: entered ? round2((reached / entered) * 100) : 0,
      conversionFromPrevious: previous ? round2((reached / previous) * 100) : 0,
      droppedOff: dropped,
      dropOffRate: previous ? round2((dropped / previous) * 100) : 0,
    };
  });
}

/**
 * The people who reached a given step and went no further.
 *
 * This is what turns a drop-off percentage into something actionable — the
 * funnel says 34% abandon at checkout, this says exactly who they were so the
 * profiles can be opened and the pattern seen.
 */
export function buildFunnelDropoffs(
  options: FunnelOptions & { atStep: number; limit?: number },
): BuiltQuery {
  const built = buildFunnel(options);
  const limit = clampLimit(options.limit, 100, 1000);

  if (options.atStep < 1 || options.atStep > options.steps.length) {
    throw new FunnelError(`atStep must be between 1 and ${options.steps.length}`);
  }

  const scope = scopeClause(options);
  const params: Record<string, unknown> = { ...built.params, limit, atStep: options.atStep };
  const conditions = options.steps.map((s, i) => stepCondition(s, i, params));
  const modeArg =
    options.mode === "strict" ? ", 'strict_order'" : options.mode === "any" ? ", 'strict_deduplication'" : "";

  return {
    sql: `
      WITH levels AS (
          SELECT
              person_id,
              windowFunnel({windowSeconds:UInt32}${modeArg})(
                  toDateTime(timestamp),
                  ${conditions.join(",\n                  ")}
              ) AS level
          FROM ${EVENTS}
          WHERE ${scope.sql}
          GROUP BY person_id
      )
      SELECT
          toString(l.person_id)            AS person_id,
          l.level                          AS reached_step,
          max(e.timestamp)                 AS last_seen,
          argMax(e.path, e.timestamp)      AS last_path,
          argMin(e.channel, e.timestamp)   AS channel,
          argMin(e.source, e.timestamp)    AS source,
          argMax(e.country, e.timestamp)   AS country,
          argMax(e.device_type, e.timestamp) AS device_type,
          count()                          AS events
      FROM levels AS l
      INNER JOIN ${EVENTS} AS e ON e.person_id = l.person_id
      WHERE l.level = {atStep:UInt8} AND ${scope.sql}
      GROUP BY l.person_id, l.level
      ORDER BY last_seen DESC
      LIMIT {limit:UInt32}
    `,
    params,
  };
}

export interface FunnelDropoffRow {
  person_id: string;
  reached_step: number;
  last_seen: string;
  last_path: string;
  channel: string;
  source: string;
  country: string;
  device_type: string;
  events: number;
}

export function funnelDropoffs(
  client: ClickHouseClient,
  options: FunnelOptions & { atStep: number; limit?: number },
): Promise<FunnelDropoffRow[]> {
  return runQuery<FunnelDropoffRow>(client, buildFunnelDropoffs(options));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
