import type { ClickHouseClient } from "@clickhouse/client";
import {
  EVENTS,
  clampLimit,
  runQuery,
  scopeClause,
  type BuiltQuery,
  type QueryScope,
} from "./base";

/**
 * Journey and drop-off analysis.
 *
 * "Where are people dropping off" is answered from two angles here, because
 * they say different things:
 *   - exit pages: the last page of a session, in absolute terms
 *   - exit *rate*: how often a page ends a session relative to how often it is
 *     viewed at all
 * A homepage usually tops the first list simply because it is the most viewed
 * page. The second list is the one that identifies a page that actually loses
 * people.
 */

export interface PathTransition {
  from_path: string;
  to_path: string;
  transitions: number;
  visitors: number;
}

/**
 * Page-to-page transitions for the Sankey diagram.
 *
 * Uses `lagInFrame` over each session's ordered pageviews. This cannot be a
 * materialized view: an MV only ever sees the block being inserted, so it can
 * never look at the previous row of a session.
 */
export function buildPathTransitions(
  options: QueryScope & { limit?: number; startPath?: string },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 50, 500);
  const params: Record<string, unknown> = { ...scope.params, limit };

  let startClause = "";
  if (options.startPath) {
    params.startPath = options.startPath;
    startClause = "AND from_path = {startPath:String}";
  }

  return {
    sql: `
      SELECT
          from_path,
          to_path,
          count()                    AS transitions,
          uniqCombined64(person_id)  AS visitors
      FROM (
          SELECT
              person_id,
              path AS to_path,
              lagInFrame(path) OVER (PARTITION BY session_id ORDER BY timestamp) AS from_path
          FROM ${EVENTS}
          WHERE ${scope.sql} AND name = '$pageview'
      )
      -- The first pageview of a session has no predecessor; lagInFrame yields
      -- an empty string there, which is not a transition.
      WHERE from_path != '' AND from_path != to_path
      ${startClause}
      GROUP BY from_path, to_path
      ORDER BY transitions DESC
      LIMIT {limit:UInt32}
    `,
    params,
  };
}

export function pathTransitions(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number; startPath?: string },
): Promise<PathTransition[]> {
  return runQuery<PathTransition>(client, buildPathTransitions(options));
}

export interface ExitPageRow {
  path: string;
  exits: number;
  pageviews: number;
  exit_rate: number;
  avg_time_sec: number;
  avg_scroll: number;
}

/**
 * Exit pages ranked by exit rate — the drop-off report.
 *
 * `minPageviews` exists because exit rate is meaningless on tiny samples: a
 * page viewed twice that ended both sessions has a 100% exit rate and tells
 * you nothing.
 */
export function buildExitPages(
  options: QueryScope & { limit?: number; minPageviews?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 25, 500);
  const minPageviews = Math.max(1, options.minPageviews ?? 10);

  return {
    sql: `
      WITH session_events AS (
          SELECT
              session_id,
              path,
              timestamp,
              duration_ms,
              props_num['scroll_depth'] AS scroll,
              name,
              -- Every event carries the URL of the page it happened on, so the
              -- last event of a session marks the page the visitor left from.
              row_number() OVER (PARTITION BY session_id ORDER BY timestamp DESC) AS rn
          FROM ${EVENTS}
          WHERE ${scope.sql}
      ),
      exits AS (
          SELECT path, count() AS exits
          FROM session_events
          WHERE rn = 1
          GROUP BY path
      ),
      views AS (
          SELECT
              path,
              countIf(name = '$pageview')                       AS pageviews,
              avgIf(duration_ms, duration_ms > 0) / 1000        AS avg_time_sec,
              avgIf(scroll, scroll > 0)                         AS avg_scroll
          FROM session_events
          GROUP BY path
      )
      SELECT
          v.path                                               AS path,
          ifNull(e.exits, 0)                                   AS exits,
          v.pageviews                                          AS pageviews,
          round(100 * ifNull(e.exits, 0) / nullIf(v.pageviews, 0), 2) AS exit_rate,
          round(v.avg_time_sec, 1)                             AS avg_time_sec,
          round(v.avg_scroll, 1)                               AS avg_scroll
      FROM views AS v
      LEFT JOIN exits AS e ON e.path = v.path
      WHERE v.pageviews >= {minPageviews:UInt32}
      ORDER BY exit_rate DESC, exits DESC
      LIMIT {limit:UInt32}
    `,
    params: { ...scope.params, limit, minPageviews },
  };
}

export function exitPages(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number; minPageviews?: number },
): Promise<ExitPageRow[]> {
  return runQuery<ExitPageRow>(client, buildExitPages(options));
}

export interface EntryPageRow {
  path: string;
  entries: number;
  visitors: number;
  bounce_rate: number;
}

/** Landing pages, with the bounce rate of the sessions they started. */
export function buildEntryPages(
  options: QueryScope & { limit?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 25, 500);

  return {
    sql: `
      SELECT
          entry_path_a                                              AS path,
          count()                                                   AS entries,
          uniqCombined64(person_id_a)                               AS visitors,
          round(100 * countIf(is_bounce_a) / nullIf(count(), 0), 2) AS bounce_rate
      FROM (
          SELECT
              -- Suffixed aliases so no aggregate alias shadows a column the WHERE
              -- clause filters on; see the note in sessions.ts.
              any(person_id)                          AS person_id_a,
              argMin(path, timestamp)                 AS entry_path_a,
              countIf(name = '$pageview')             AS pv,
              count()                                 AS ev,
              pv <= 1 AND ev <= 2                     AS is_bounce_a
          FROM ${EVENTS}
          WHERE ${scope.sql}
          GROUP BY session_id
      )
      GROUP BY entry_path_a
      ORDER BY entries DESC
      LIMIT {limit:UInt32}
    `,
    params: { ...scope.params, limit },
  };
}

export function entryPages(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number },
): Promise<EntryPageRow[]> {
  return runQuery<EntryPageRow>(client, buildEntryPages(options));
}

export interface FrustrationRow {
  path: string;
  rage_clicks: number;
  dead_clicks: number;
  errors: number;
  affected_visitors: number;
}

/**
 * Pages where people are visibly struggling. Rage clicks, dead clicks and JS
 * errors are the qualitative counterpart to a high exit rate — they explain
 * *why* a page loses people rather than just showing that it does.
 */
export function buildFrustration(
  options: QueryScope & { limit?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 25, 200);

  return {
    sql: `
      SELECT
          path,
          countIf(name = '$rage_click')  AS rage_clicks,
          countIf(name = '$dead_click')  AS dead_clicks,
          countIf(name = '$error')       AS errors,
          uniqCombined64If(person_id, name IN ('$rage_click', '$dead_click', '$error')) AS affected_visitors
      FROM ${EVENTS}
      WHERE ${scope.sql}
        AND name IN ('$rage_click', '$dead_click', '$error')
      GROUP BY path
      ORDER BY (rage_clicks + dead_clicks + errors) DESC
      LIMIT {limit:UInt32}
    `,
    params: { ...scope.params, limit },
  };
}

export function frustration(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number },
): Promise<FrustrationRow[]> {
  return runQuery<FrustrationRow>(client, buildFrustration(options));
}
