import type { ClickHouseClient } from "@clickhouse/client";
import {
  EVENTS,
  clampLimit,
  runQuery,
  scopeClause,
  type BuiltQuery,
  type QueryScope,
} from "./base";
import { resolveBreakdown } from "./filters";

/**
 * The organization-wide "state of X" rollup, for the public
 * `/benchmark/[token]` page.
 *
 * Deliberately the narrowest read in this package. `scope.projectIds` fans
 * the query across the whole portfolio the same way `overview.ts` does, but
 * unlike everything else here there is no `project_id` in any SELECT list, no
 * path, no person — a single row of aggregate figures. This feeds an
 * unauthenticated public page, so the query shape itself is the privacy
 * boundary: there is nothing per-property left in the result set to leak.
 */

export interface BenchmarkChannel {
  channel: string;
  /** Percent of sessions attributed to this channel, 0-100. */
  share: number;
}

export interface BenchmarkRow {
  visitors: number;
  sessions: number;
  pageviews: number;
  bounce_rate: number;
  avg_session_sec: number;
  median_session_sec: number;
  top_channels: BenchmarkChannel[];
}

/**
 * Headline totals, aggregated to one row per session first — same reasoning
 * as `buildTotals` in trends.ts: bounce rate and duration are session
 * properties, not event properties, so averaging over raw events would weight
 * a session by how many events it happened to produce.
 */
export function buildBenchmarkTotals(scope: QueryScope): BuiltQuery {
  const s = scopeClause(scope);
  return {
    sql: `
      SELECT
          uniqCombined64(person_id_a)                                AS visitors,
          count()                                                    AS sessions,
          sum(pv)                                                    AS pageviews,
          round(100 * countIf(is_bounce_a) / nullIf(count(), 0), 2)  AS bounce_rate,
          round(avg(session_seconds), 1)                             AS avg_session_sec,
          round(median(session_seconds), 1)                          AS median_session_sec
      FROM (
          SELECT
              any(person_id)                                         AS person_id_a,
              countIf(name = '$pageview')                            AS pv,
              dateDiff('second', min(timestamp), max(timestamp))     AS session_seconds,
              countIf(name = '$pageview') <= 1 AND count() <= 2      AS is_bounce_a
          FROM ${EVENTS}
          WHERE ${s.sql}
          GROUP BY session_id
      )
    `,
    params: s.params,
  };
}

/**
 * Top channels by share of sessions, portfolio-wide.
 *
 * Resolved per session from that session's first event, same as
 * `buildBreakdown`'s acquisition-field path in trends.ts — a channel is a
 * property of how a visit began, not of every event inside it.
 */
export function buildBenchmarkChannels(scope: QueryScope, limit = 3): BuiltQuery {
  const s = scopeClause(scope);
  const bd = resolveBreakdown("channel");
  const top = clampLimit(limit, 3, 10);

  return {
    sql: `
      WITH session_acquisition AS (
          SELECT
              session_id,
              argMin(${bd.expr}, timestamp) AS value
          FROM ${EVENTS}
          WHERE ${s.sql}
          GROUP BY session_id
      ),
      session_total AS (
          SELECT count() AS total FROM session_acquisition
      )
      SELECT
          value                                                                    AS channel,
          round(100 * count() / nullIf((SELECT total FROM session_total), 0), 2)   AS share
      FROM session_acquisition
      GROUP BY channel
      ORDER BY share DESC
      LIMIT {limit:UInt32}
    `,
    params: { ...s.params, ...bd.params, limit: top },
  };
}

/** Combined benchmark report — the whole payload the public page renders. */
export async function benchmarkReport(
  client: ClickHouseClient,
  scope: QueryScope,
): Promise<BenchmarkRow> {
  const [totalsRows, channels] = await Promise.all([
    runQuery<Omit<BenchmarkRow, "top_channels">>(client, buildBenchmarkTotals(scope)),
    runQuery<BenchmarkChannel>(client, buildBenchmarkChannels(scope)),
  ]);

  const t = totalsRows[0];
  return {
    visitors: t?.visitors ?? 0,
    sessions: t?.sessions ?? 0,
    pageviews: t?.pageviews ?? 0,
    bounce_rate: t?.bounce_rate ?? 0,
    avg_session_sec: t?.avg_session_sec ?? 0,
    median_session_sec: t?.median_session_sec ?? 0,
    top_channels: channels,
  };
}
