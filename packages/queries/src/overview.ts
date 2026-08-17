import type { ClickHouseClient } from "@clickhouse/client";
import {
  EVENTS,
  chDate,
  chDateEnd,
  chDateTime,
  runQuery,
  type BuiltQuery,
  type DateRange,
} from "./base";

/**
 * The all-projects overview — every property at a glance, in one query rather
 * than one per project.
 *
 * Reads the `daily_stats` rollup instead of the firehose. Scanning raw events
 * for every project on every dashboard load is exactly the pattern that makes
 * self-hosted analytics feel slow; this touches a few rows per project per day.
 */

export interface ProjectOverviewRow {
  project_id: number;
  visitors: number;
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
  /** Same metrics over the immediately preceding window, for deltas. */
  prev_visitors: number;
  prev_pageviews: number;
}

export function buildPortfolioOverview(options: {
  projectIds: number[];
  range: DateRange;
}): BuiltQuery {
  const span = options.range.to - options.range.from;
  const prevFrom = options.range.from - span;

  // Two separate CTEs rather than a conditional merge. There is no
  // `-MergeIf` combinator: -Merge takes an aggregate state and -If takes a raw
  // value, and they cannot be stacked, so the current and previous windows have
  // to be aggregated independently and joined.
  return {
    sql: `
      WITH current_window AS (
          SELECT
              project_id,
              uniqCombined64Merge(visitors)  AS visitors,
              uniqCombined64Merge(sessions)  AS sessions,
              sum(pageviews)                 AS pageviews,
              sum(events)                    AS events,
              round(sum(revenue), 4)         AS revenue
          FROM daily_stats
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND date >= {from:Date}
            AND date <= {to:Date}
          GROUP BY project_id
      ),
      previous_window AS (
          SELECT
              project_id,
              uniqCombined64Merge(visitors) AS visitors,
              sum(pageviews)                AS pageviews
          FROM daily_stats
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND date >= {prevFrom:Date}
            AND date < {from:Date}
          GROUP BY project_id
      )
      SELECT
          c.project_id            AS project_id,
          c.visitors              AS visitors,
          c.sessions              AS sessions,
          c.pageviews             AS pageviews,
          c.events                AS events,
          c.revenue               AS revenue,
          ifNull(p.visitors, 0)   AS prev_visitors,
          ifNull(p.pageviews, 0)  AS prev_pageviews
      FROM current_window AS c
      LEFT JOIN previous_window AS p ON p.project_id = c.project_id
      ORDER BY visitors DESC
    `,
    params: {
      projectIds: options.projectIds,
      from: chDate(options.range.from),
      to: chDateEnd(options.range.to),
      prevFrom: chDate(prevFrom),
    },
  };
}

export function portfolioOverview(
  client: ClickHouseClient,
  options: { projectIds: number[]; range: DateRange },
): Promise<ProjectOverviewRow[]> {
  return runQuery<ProjectOverviewRow>(client, buildPortfolioOverview(options));
}

export interface SparklinePoint {
  project_id: number;
  date: string;
  visitors: number;
  pageviews: number;
}

/** Per-project daily series for the overview sparklines. */
export function buildPortfolioSparklines(options: {
  projectIds: number[];
  range: DateRange;
}): BuiltQuery {
  return {
    // `toString(date) AS date` would shadow the real column, making the WHERE
    // clause compare a String against a Date parameter — "no supertype for
    // types String, Date". The cast happens in the outer SELECT instead.
    sql: `
      SELECT
          project_id,
          toString(day)  AS date,
          visitors,
          pageviews
      FROM (
          SELECT
              project_id,
              date                           AS day,
              uniqCombined64Merge(visitors)  AS visitors,
              sum(pageviews)                 AS pageviews
          FROM daily_stats
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND date >= {from:Date}
            AND date <= {to:Date}
          GROUP BY project_id, date
      )
      ORDER BY project_id, day
    `,
    params: {
      projectIds: options.projectIds,
      from: chDate(options.range.from),
      to: chDateEnd(options.range.to),
    },
  };
}

export function portfolioSparklines(
  client: ClickHouseClient,
  options: { projectIds: number[]; range: DateRange },
): Promise<SparklinePoint[]> {
  return runQuery<SparklinePoint>(client, buildPortfolioSparklines(options));
}

export interface CrossProjectPerson {
  person_id: string;
  project_count: number;
  project_ids: number[];
  first_seen: string;
  last_seen: string;
  total_events: number;
}

/**
 * People who have used more than one of the organization's products.
 *
 * The headline cross-portfolio insight: someone who read the blog and then
 * signed up for a different product is a materially different lead from a
 * first-time visitor, and nothing in a per-site analytics tool can surface it.
 */
export function buildCrossProjectPeople(options: {
  projectIds: number[];
  range: DateRange;
  minProjects?: number;
  limit?: number;
}): BuiltQuery {
  const minProjects = Math.max(2, options.minProjects ?? 2);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);

  return {
    sql: `
      SELECT
          toString(person_id)         AS person_id,
          uniqExact(project_id)       AS project_count,
          groupUniqArray(project_id)  AS project_ids,
          min(timestamp)              AS first_seen,
          max(timestamp)              AS last_seen,
          count()                     AS total_events
      FROM events_v
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND timestamp >= {from:DateTime64(3)}
        AND timestamp < {to:DateTime64(3)}
        AND is_bot = 0
      GROUP BY person_id
      HAVING project_count >= {minProjects:UInt8}
      ORDER BY project_count DESC, last_seen DESC
      LIMIT {limit:UInt32}
    `,
    params: {
      projectIds: options.projectIds,
      from: chDateTime(options.range.from),
      to: chDateTime(options.range.to),
      minProjects,
      limit,
    },
  };
}

export function crossProjectPeople(
  client: ClickHouseClient,
  options: { projectIds: number[]; range: DateRange; minProjects?: number; limit?: number },
): Promise<CrossProjectPerson[]> {
  return runQuery<CrossProjectPerson>(client, buildCrossProjectPeople(options));
}

export interface InstallStatusRow {
  project_id: number;
  first_event: string;
  last_event: string;
  events_24h: number;
  events_total: number;
}

/**
 * Whether a property is actually receiving events.
 *
 * "Is my snippet working" is the first question every new property raises, and
 * until now the only answer available was an empty dashboard — which looks
 * identical to a quiet week. This separates the three states that matter:
 * never installed (no events at all), installed and live (events recently),
 * and installed but silent (events once, none lately).
 *
 * Bots are deliberately *included*. A crawler hitting the page proves the
 * snippet is served and the collector is reachable, which is exactly what an
 * installation check is asking. Excluding them would report a working install
 * as broken whenever the only traffic so far was a crawler.
 */
export function buildInstallStatus(options: {
  projectIds: number[];
  now?: number;
}): BuiltQuery {
  const now = options.now ?? Date.now();

  return {
    sql: `
      SELECT
          project_id,
          toString(min(timestamp))                              AS first_event,
          toString(max(timestamp))                              AS last_event,
          countIf(timestamp >= {since:DateTime64(3)})           AS events_24h,
          count()                                               AS events_total
      FROM ${EVENTS}
      WHERE has({projectIds:Array(UInt32)}, project_id)
      GROUP BY project_id
    `,
    params: {
      projectIds: options.projectIds,
      since: chDateTime(now - 86_400_000),
    },
  };
}

export function installStatus(
  client: ClickHouseClient,
  options: { projectIds: number[]; now?: number },
): Promise<InstallStatusRow[]> {
  return runQuery<InstallStatusRow>(client, buildInstallStatus(options));
}
