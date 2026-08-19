import type { ClickHouseClient } from "@clickhouse/client";
import {
  EVENTS,
  chDate,
  chDateEnd,
  clampLimit,
  runQuery,
  scopeClause,
  type BuiltQuery,
  type QueryScope,
} from "./base";

/**
 * Funnel-agnostic abandonment: where people came from, right before they left
 * the site entirely — without a caller-supplied funnel or goal definition.
 *
 * `path_transitions` (the 15-minute rollup `rebuildPathTransitions` in
 * `apps/worker` maintains) only ever records page-to-page hops: it is built
 * from `lagInFrame(path)` over each session's pageviews, so the *last*
 * pageview of a session produces no outgoing row at all. There is no exit
 * sentinel in this table — `to_path` is always a real page, never a marker
 * for "left the site". That rules out the naive read of "rank `to_path` by
 * something in this table" as a drop-off signal: every row here is a page
 * someone went on to view, which is the opposite of abandonment.
 *
 * So this does not read `path_transitions` alone. It cross-references it
 * with `exitPages` (`paths.ts`), which already knows genuine exits — the
 * last event of a session — at the page level. Joining the two turns
 * "page X has a high exit rate" (no sequence) and "X then Y happens often"
 * (no exit information) into one sequence-aware claim neither query alone
 * can make: people who came from `fromPath`, landed on `toPath`, and left
 * from `toPath` at an unusually high rate. `exitShare` is `toPath`'s
 * page-level exit rate (not conditioned on `fromPath` — the two source
 * tables aren't joined at the session level) — read it as "of everyone who
 * lands on this page via this route, roughly this fraction leave from here",
 * not as an exact per-edge exit rate.
 *
 * Ranked by `exitShare * transitions`: a rough "sessions likely lost on this
 * edge" estimate, so a high-exit-rate page nobody actually travels through
 * doesn't outrank a merely-elevated one carrying real volume.
 */
export interface DropoffRow {
  fromPath: string;
  toPath: string;
  transitions: number;
  visitors: number;
  /** `toPath`'s page-level exit rate (0-100), from the same period. */
  exitShare: number;
}

export function buildTopDropoffs(
  options: QueryScope & { limit?: number; minPageviews?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 15, 50);
  const minPageviews = Math.max(1, options.minPageviews ?? 10);

  const params: Record<string, unknown> = {
    ...scope.params,
    limit,
    minPageviews,
    fromDate: chDate(options.range.from),
    toDate: chDateEnd(options.range.to),
  };

  return {
    sql: `
      WITH session_events AS (
          SELECT
              session_id,
              path,
              name,
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
          SELECT path, countIf(name = '$pageview') AS pageviews
          FROM session_events
          GROUP BY path
      ),
      exit_pages AS (
          SELECT
              v.path AS path,
              round(100 * ifNull(e.exits, 0) / nullIf(v.pageviews, 0), 2) AS exit_rate
          FROM views AS v
          LEFT JOIN exits AS e ON e.path = v.path
          WHERE v.pageviews >= {minPageviews:UInt32}
      ),
      inbound AS (
          SELECT
              from_path,
              to_path,
              sum(transitions)              AS transitions,
              uniqCombined64Merge(visitors) AS visitors
          FROM path_transitions
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND date >= {fromDate:Date}
            AND date <= {toDate:Date}
          GROUP BY from_path, to_path
      )
      SELECT
          i.from_path   AS fromPath,
          i.to_path     AS toPath,
          i.transitions AS transitions,
          i.visitors    AS visitors,
          ep.exit_rate  AS exitShare
      FROM inbound AS i
      INNER JOIN exit_pages AS ep ON ep.path = i.to_path
      WHERE ep.exit_rate > 0
      ORDER BY (ep.exit_rate * i.transitions) DESC, i.transitions DESC
      LIMIT {limit:UInt32}
    `,
    params,
  };
}

export function topDropoffs(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number; minPageviews?: number },
): Promise<DropoffRow[]> {
  return runQuery<DropoffRow>(client, buildTopDropoffs(options));
}
