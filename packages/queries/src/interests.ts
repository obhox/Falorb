import type { ClickHouseClient } from "@clickhouse/client";
import { EVENTS, clampLimit, runQuery, scopeClause, type BuiltQuery, type QueryScope } from "./base";

/**
 * Project-level rollup of the interest signal.
 *
 * Reuses the exact topic-derivation expression from `buildPersonInterests`
 * (`persons.ts`): a `content_tag` property when the site sets one, else the
 * first real path segment. A project rollup is the same underlying signal
 * `interest-scorer.ts` and `buildPersonInterests` already use for a single
 * person, aggregated across everyone instead of one profile — not a new kind
 * of claim, just a wider one.
 *
 * Computed live from `events_v` rather than from the worker-maintained
 * `persons.interestScores` column: that column is overwritten on every worker
 * run (no history, so it cannot show a trend) and is refreshed on a fixed
 * schedule independent of whatever date range a caller actually wants.
 */
export interface ContentInterestRow {
  topic: string;
  visitors: number;
  distinct_paths: number;
  pageviews: number;
  events: number;
}

export function buildContentInterests(
  options: QueryScope & { limit?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 20, 200);

  return {
    sql: `
      SELECT
          topic,
          uniqCombined64(person_id)   AS visitors,
          uniqExact(path)             AS distinct_paths,
          countIf(name = '$pageview') AS pageviews,
          count()                     AS events
      FROM (
          SELECT
              person_id,
              path,
              name,
              if(
                  props_str['content_tag'] != '',
                  props_str['content_tag'],
                  splitByChar('/', path)[2]
              ) AS topic
          FROM ${EVENTS}
          WHERE ${scope.sql}
      )
      WHERE topic != ''
      GROUP BY topic
      ORDER BY visitors DESC, events DESC
      LIMIT {limit:UInt32}
    `,
    params: { ...scope.params, limit },
  };
}

export function contentInterests(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number },
): Promise<ContentInterestRow[]> {
  return runQuery<ContentInterestRow>(client, buildContentInterests(options));
}
