import type { ClickHouseClient } from "@clickhouse/client";
import { EVENTS, chDateTime, clampLimit, runQuery, type BuiltQuery } from "./base";

/**
 * Realtime views.
 *
 * These read `events` directly rather than any rollup: a materialized view is
 * populated on insert but the aggregate is only merged in the background, and
 * "who is on the site right now" cannot tolerate that lag. The window is
 * minutes wide, so the scan is tiny regardless.
 */

const LIVE_WINDOW_MS = 5 * 60 * 1000;

export interface LiveVisitor {
  person_id: string;
  project_id: number;
  last_seen: string;
  current_path: string;
  current_title: string;
  host: string;
  channel: string;
  source: string;
  country: string;
  city: string;
  device_type: string;
  browser: string;
  pageviews: number;
  seconds_on_site: number;
}

export function buildLiveVisitors(options: {
  projectIds: number[];
  windowMs?: number;
  limit?: number;
  now?: number;
}): BuiltQuery {
  const now = options.now ?? Date.now();
  const since = now - (options.windowMs ?? LIVE_WINDOW_MS);
  const limit = clampLimit(options.limit, 100, 500);

  return {
    // Suffixed inner aliases, renamed outside — see the note in sessions.ts:
    // aliasing an aggregate to a real column name breaks the WHERE clause.
    sql: `
      SELECT
          person_id_a     AS person_id,
          project_id_a    AS project_id,
          last_seen_a     AS last_seen,
          current_path_a  AS current_path,
          current_title_a AS current_title,
          host_a          AS host,
          channel_a       AS channel,
          source_a        AS source,
          country_a       AS country,
          city_a          AS city,
          device_type_a   AS device_type,
          browser_a       AS browser,
          pageviews_a     AS pageviews,
          seconds_a       AS seconds_on_site
      FROM (
          SELECT
              toString(person_id)                 AS person_id_a,
              any(project_id)                     AS project_id_a,
              max(timestamp)                      AS last_seen_a,
              argMax(path, timestamp)             AS current_path_a,
              argMax(title, timestamp)            AS current_title_a,
              argMax(host, timestamp)             AS host_a,
              argMin(channel, timestamp)          AS channel_a,
              argMin(source, timestamp)           AS source_a,
              argMax(country, timestamp)          AS country_a,
              argMax(city, timestamp)             AS city_a,
              argMax(device_type, timestamp)      AS device_type_a,
              argMax(browser, timestamp)          AS browser_a,
              countIf(name = '$pageview')         AS pageviews_a,
              dateDiff('second', min(timestamp), max(timestamp)) AS seconds_a
          FROM ${EVENTS}
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND timestamp >= {since:DateTime64(3)}
            AND is_bot = 0
          GROUP BY person_id
      )
      ORDER BY last_seen DESC
      LIMIT {limit:UInt32}
    `,
    params: { projectIds: options.projectIds, since: chDateTime(since), limit },
  };
}

export function liveVisitors(
  client: ClickHouseClient,
  options: { projectIds: number[]; windowMs?: number; limit?: number; now?: number },
): Promise<LiveVisitor[]> {
  return runQuery<LiveVisitor>(client, buildLiveVisitors(options));
}

export interface LiveCount {
  project_id: number;
  visitors: number;
}

/** Current visitor count per project, for the portfolio overview. */
export function buildLiveCounts(options: {
  projectIds: number[];
  windowMs?: number;
  now?: number;
}): BuiltQuery {
  const now = options.now ?? Date.now();
  const since = now - (options.windowMs ?? LIVE_WINDOW_MS);

  return {
    sql: `
      SELECT project_id, uniqCombined64(person_id) AS visitors
      FROM ${EVENTS}
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND timestamp >= {since:DateTime64(3)}
        AND is_bot = 0
      GROUP BY project_id
    `,
    params: { projectIds: options.projectIds, since: chDateTime(since) },
  };
}

export function liveCounts(
  client: ClickHouseClient,
  options: { projectIds: number[]; windowMs?: number; now?: number },
): Promise<LiveCount[]> {
  return runQuery<LiveCount>(client, buildLiveCounts(options));
}

export interface LiveEvent {
  timestamp: string;
  project_id: number;
  person_id: string;
  name: string;
  path: string;
  country: string;
  device_type: string;
  props_raw: string;
}

/**
 * Tail of the event stream, newest first. Backs the live feed and the
 * "verify my install is working" panel, where seeing the very next event
 * arrive is the entire point.
 */
export function buildLiveFeed(options: {
  projectIds: number[];
  since?: number;
  limit?: number;
  includeBots?: boolean;
}): BuiltQuery {
  const limit = clampLimit(options.limit, 50, 500);
  const since = options.since ?? Date.now() - LIVE_WINDOW_MS;

  return {
    sql: `
      SELECT
          timestamp,
          project_id,
          toString(person_id) AS person_id,
          name,
          path,
          country,
          device_type,
          props_raw
      FROM ${EVENTS}
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND timestamp >= {since:DateTime64(3)}
        ${options.includeBots ? "" : "AND is_bot = 0"}
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}
    `,
    params: { projectIds: options.projectIds, since: chDateTime(since), limit },
  };
}

export function liveFeed(
  client: ClickHouseClient,
  options: { projectIds: number[]; since?: number; limit?: number; includeBots?: boolean },
): Promise<LiveEvent[]> {
  return runQuery<LiveEvent>(client, buildLiveFeed(options));
}
