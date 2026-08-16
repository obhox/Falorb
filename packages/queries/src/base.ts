import type { ClickHouseClient } from "@clickhouse/client";
import { compileFilters, type Filter } from "./filters";

/**
 * Shared plumbing for every query in this package.
 *
 * All reads go through `events_v`, never `events`. That view applies the
 * person_overrides dictionary, so identity merges are reflected retroactively;
 * querying the raw table would show a signed-up user's history split across
 * their old anonymous id.
 */
export const EVENTS = "events_v";

export type Interval = "hour" | "day" | "week" | "month";

export interface DateRange {
  /** Inclusive lower bound, epoch ms. */
  from: number;
  /** Exclusive upper bound, epoch ms. */
  to: number;
}

export interface QueryScope {
  /** One or more projects. Multiple ids power the cross-project views. */
  projectIds: number[];
  range: DateRange;
  filters?: Filter[];
  /** Bots are excluded by default; crawl traffic has its own report. */
  includeBots?: boolean;
}

export interface BuiltQuery {
  sql: string;
  params: Record<string, unknown>;
}

/** Format epoch ms for a ClickHouse DateTime64(3) parameter. */
export function chDateTime(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "");
}

export function chDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * The last calendar date touched by a half-open timestamp range `[from, to)`.
 *
 * Needed whenever a range expressed in timestamps is compared against a `Date`
 * column. Truncating the exclusive upper bound and keeping the comparison
 * exclusive silently drops the current day: a range ending "now" truncates to
 * today, and `date < today` excludes every event recorded today. That reads as
 * "no data" rather than as a bug, which is what makes it dangerous.
 *
 * Pair this with an inclusive comparison: `date <= {to:Date}`.
 */
export function chDateEnd(epochMs: number): string {
  return new Date(epochMs - 1).toISOString().slice(0, 10);
}

/**
 * Build the WHERE clause shared by every event query: project scope, time
 * bounds, bot exclusion, and the caller's filters — all parameterized.
 */
export function scopeClause(scope: QueryScope, prefix = "f"): BuiltQuery {
  const params: Record<string, unknown> = {
    projectIds: scope.projectIds,
    from: chDateTime(scope.range.from),
    to: chDateTime(scope.range.to),
  };

  const parts = [
    "has({projectIds:Array(UInt32)}, project_id)",
    "timestamp >= {from:DateTime64(3)}",
    "timestamp < {to:DateTime64(3)}",
  ];

  if (!scope.includeBots) parts.push("is_bot = 0");

  if (scope.filters?.length) {
    const compiled = compileFilters(scope.filters, prefix);
    parts.push(compiled.sql);
    Object.assign(params, compiled.params);
  }

  return { sql: parts.join(" AND "), params };
}

/** ClickHouse expression bucketing `timestamp` to the requested interval. */
export function intervalExpr(interval: Interval, column = "timestamp"): string {
  switch (interval) {
    case "hour":
      return `toStartOfHour(${column})`;
    case "week":
      return `toStartOfWeek(${column}, 1)`; // ISO weeks start Monday
    case "month":
      return `toStartOfMonth(${column})`;
    default:
      return `toStartOfDay(${column})`;
  }
}

/**
 * Pick a sensible bucket size for a range when the caller has no preference.
 * An hourly series over a year would return 8,760 points that no chart can
 * render usefully.
 */
export function autoInterval(range: DateRange): Interval {
  const days = (range.to - range.from) / 86_400_000;
  if (days <= 2) return "hour";
  if (days <= 90) return "day";
  if (days <= 730) return "week";
  return "month";
}

export async function runQuery<T>(
  client: ClickHouseClient,
  built: BuiltQuery,
): Promise<T[]> {
  const result = await client.query({
    query: built.sql,
    query_params: built.params,
    format: "JSONEachRow",
  });
  return result.json<T>();
}

/**
 * Clamp a caller-supplied row limit.
 *
 * Every list endpoint takes a limit, and an unbounded one is an easy way to
 * make the server stream millions of rows into memory.
 */
export function clampLimit(limit: number | undefined, fallback = 100, max = 1000): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return fallback;
  return Math.min(Math.floor(limit), max);
}
