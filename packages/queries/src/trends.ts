import type { ClickHouseClient } from "@clickhouse/client";
import {
  EVENTS,
  autoInterval,
  clampLimit,
  intervalExpr,
  runQuery,
  scopeClause,
  type BuiltQuery,
  type Interval,
  type QueryScope,
} from "./base";
import { resolveBreakdown } from "./filters";

export type Metric =
  | "visitors"
  | "sessions"
  | "pageviews"
  | "events"
  | "revenue"
  | "bounce_rate"
  | "avg_duration";

export interface TrendOptions extends QueryScope {
  metric: Metric;
  interval?: Interval;
  /** Optional dimension to split the series by, e.g. "channel" or "prop:plan". */
  breakdown?: string;
  /** Maximum breakdown series returned, by descending total. */
  limit?: number;
}

export interface TrendPoint {
  bucket: string;
  series: string;
  value: number;
}

/**
 * Metric expressions.
 *
 * `uniqCombined64` rather than `uniqExact`: an approximate distinct count is
 * within a fraction of a percent at these volumes and costs a small fixed
 * amount of memory instead of holding every id in a hash set.
 */
function metricExpr(metric: Metric): string {
  switch (metric) {
    case "visitors":
      return "uniqCombined64(person_id)";
    case "sessions":
      return "uniqCombined64(session_id)";
    case "pageviews":
      return "countIf(name = '$pageview')";
    case "events":
      return "count()";
    case "revenue":
      return "sum(ifNull(toFloat64(revenue), 0))";
    case "avg_duration":
      return "avgIf(duration_ms, duration_ms > 0) / 1000";
    case "bounce_rate":
      // Computed from the session rollup instead; see buildTrend.
      return "0";
  }
}

export function buildTrend(options: TrendOptions): BuiltQuery {
  const scope = scopeClause(options);
  const interval = options.interval ?? autoInterval(options.range);
  const bucket = intervalExpr(interval);
  const limit = clampLimit(options.limit, 10, 50);

  const params: Record<string, unknown> = { ...scope.params, limit };
  let seriesExpr = "'all'";

  if (options.breakdown) {
    const bd = resolveBreakdown(options.breakdown);
    seriesExpr = bd.expr;
    Object.assign(params, bd.params);
  }

  // Bounce rate is a session-level property, so it cannot be derived by
  // aggregating events directly — a session is a bounce or it is not, and
  // that is only knowable once its whole event set is considered.
  if (options.metric === "bounce_rate") {
    return {
      sql: `
        SELECT
            toString(bucket) AS bucket,
            'all' AS series,
            round(100 * countIf(is_bounce) / nullIf(count(), 0), 2) AS value
        FROM (
            SELECT
                ${intervalExpr(interval, "min(timestamp)")} AS bucket,
                session_id,
                countIf(name = '$pageview') <= 1 AND count() <= 2 AS is_bounce
            FROM ${EVENTS}
            WHERE ${scope.sql}
            GROUP BY session_id
        )
        GROUP BY bucket
        ORDER BY bucket
      `,
      params,
    };
  }

  return {
    sql: `
      WITH top_series AS (
          SELECT ${seriesExpr} AS series
          FROM ${EVENTS}
          WHERE ${scope.sql}
          GROUP BY series
          ORDER BY ${metricExpr(options.metric)} DESC
          LIMIT {limit:UInt32}
      )
      SELECT
          toString(${bucket}) AS bucket,
          ${seriesExpr} AS series,
          ${metricExpr(options.metric)} AS value
      FROM ${EVENTS}
      WHERE ${scope.sql}
        AND ${options.breakdown ? `${seriesExpr} IN (SELECT series FROM top_series)` : "1"}
      GROUP BY bucket, series
      ORDER BY bucket, value DESC
    `,
    params,
  };
}

export function trend(
  client: ClickHouseClient,
  options: TrendOptions,
): Promise<TrendPoint[]> {
  return runQuery<TrendPoint>(client, buildTrend(options));
}

export interface BreakdownRow {
  value: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
}

/**
 * Top values for a dimension — the shape behind every "top pages", "top
 * sources", "top countries" panel.
 */
export function buildBreakdown(
  options: QueryScope & { field: string; limit?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const bd = resolveBreakdown(options.field);
  const limit = clampLimit(options.limit, 20, 500);

  return {
    sql: `
      SELECT
          ${bd.expr} AS value,
          uniqCombined64(person_id)          AS visitors,
          uniqCombined64(session_id)         AS sessions,
          countIf(name = '$pageview')        AS pageviews,
          count()                            AS events,
          sum(ifNull(toFloat64(revenue), 0)) AS revenue
      FROM ${EVENTS}
      WHERE ${scope.sql}
      GROUP BY value
      ORDER BY visitors DESC, events DESC
      LIMIT {limit:UInt32}
    `,
    params: { ...scope.params, ...bd.params, limit },
  };
}

export function breakdown(
  client: ClickHouseClient,
  options: QueryScope & { field: string; limit?: number },
): Promise<BreakdownRow[]> {
  return runQuery<BreakdownRow>(client, buildBreakdown(options));
}

export interface TotalsRow {
  visitors: number;
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
  bounce_rate: number;
  avg_session_sec: number;
  views_per_session: number;
}

/**
 * Headline KPI block for a project or the whole portfolio.
 *
 * Aggregates to one row per session first, then aggregates those. Bounce rate
 * and session duration are properties *of a session*, so computing them over
 * raw event rows would weight every session by how many events it happened to
 * contain — a 40-event session would count forty times toward the rate.
 */
export function buildTotals(scope: QueryScope): BuiltQuery {
  const s = scopeClause(scope);
  return {
    sql: `
      SELECT
          uniqCombined64(person_id_a)                                AS visitors,
          count()                                                    AS sessions,
          sum(pv)                                                    AS pageviews,
          sum(ev)                                                    AS events,
          round(sum(rev), 4)                                         AS revenue,
          round(100 * countIf(is_bounce_a) / nullIf(count(), 0), 2)  AS bounce_rate,
          round(avg(session_seconds), 1)                             AS avg_session_sec,
          round(sum(pv) / nullIf(count(), 0), 2)                     AS views_per_session
      FROM (
          SELECT
              -- Suffixed aliases so no aggregate alias shadows a column the WHERE
              -- clause filters on; see the note in sessions.ts.
              any(person_id)                                         AS person_id_a,
              countIf(name = '$pageview')                            AS pv,
              count()                                                AS ev,
              sum(ifNull(toFloat64(revenue), 0))                     AS rev,
              dateDiff('second', min(timestamp), max(timestamp))     AS session_seconds,
              pv <= 1 AND ev <= 2                                    AS is_bounce_a
          FROM ${EVENTS}
          WHERE ${s.sql}
          GROUP BY session_id
      )
    `,
    params: s.params,
  };
}

export async function totals(
  client: ClickHouseClient,
  scope: QueryScope,
): Promise<TotalsRow> {
  const rows = await runQuery<TotalsRow>(client, buildTotals(scope));
  return (
    rows[0] ?? {
      visitors: 0,
      sessions: 0,
      pageviews: 0,
      events: 0,
      revenue: 0,
      bounce_rate: 0,
      avg_session_sec: 0,
      views_per_session: 0,
    }
  );
}
