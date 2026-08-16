import type { ClickHouseClient } from "@clickhouse/client";
import {
  EVENTS,
  chDateTime,
  clampLimit,
  runQuery,
  scopeClause,
  type BuiltQuery,
  type QueryScope,
} from "./base";

/**
 * Session-level queries.
 *
 * These read `events_v` and aggregate on the fly rather than reading the
 * `sessions` rollup, because the rollup is keyed on the raw person_id written
 * at ingest and does not pass through the identity-override dictionary. For a
 * session list that must reflect merges, correctness beats the saved scan.
 * The rollup remains the right source for aggregate counts, where a merged
 * identity does not change the totals.
 */

export interface SessionRow {
  session_id: string;
  person_id: string;
  project_id: number;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  pageviews: number;
  events: number;
  entry_path: string;
  exit_path: string;
  channel: string;
  source: string;
  referrer_host: string;
  country: string;
  city: string;
  device_type: string;
  browser: string;
  os: string;
  max_scroll: number;
  rage_clicks: number;
  errors: number;
  revenue: number;
  is_bounce: boolean;
}

export function buildSessionList(
  options: QueryScope & { personId?: string; limit?: number; offset?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 50, 500);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const params: Record<string, unknown> = { ...scope.params, limit, offset };

  let personClause = "";
  if (options.personId) {
    params.personId = options.personId;
    personClause = "AND person_id = {personId:UUID}";
  }

  // Aggregate aliases carry an `_a` suffix and are renamed in the outer SELECT.
  // Aliasing an aggregate to the name of a real column (`any(source) AS source`)
  // makes ClickHouse resolve the WHERE clause's reference to the *alias*, and it
  // then rejects the query with "aggregate function found in WHERE". Any filter
  // on channel, source, country, revenue and so on would hit that.
  return {
    sql: `
      SELECT
          session_id_a    AS session_id,
          person_id_a     AS person_id,
          project_id_a    AS project_id,
          started_at_a    AS started_at,
          ended_at_a      AS ended_at,
          duration_sec_a  AS duration_sec,
          pageviews_a     AS pageviews,
          events_a        AS events,
          entry_path_a    AS entry_path,
          exit_path_a     AS exit_path,
          channel_a       AS channel,
          source_a        AS source,
          referrer_host_a AS referrer_host,
          country_a       AS country,
          city_a          AS city,
          device_type_a   AS device_type,
          browser_a       AS browser,
          os_a            AS os,
          max_scroll_a    AS max_scroll,
          rage_clicks_a   AS rage_clicks,
          errors_a        AS errors,
          revenue_a       AS revenue,
          is_bounce_a     AS is_bounce
      FROM (
          SELECT
              toString(session_id)                                AS session_id_a,
              toString(any(person_id))                            AS person_id_a,
              any(project_id)                                     AS project_id_a,
              min(timestamp)                                      AS started_at_a,
              max(timestamp)                                      AS ended_at_a,
              dateDiff('second', min(timestamp), max(timestamp))  AS duration_sec_a,
              countIf(name = '$pageview')                         AS pageviews_a,
              count()                                             AS events_a,
              argMin(path, timestamp)                             AS entry_path_a,
              argMax(path, timestamp)                             AS exit_path_a,
              argMin(channel, timestamp)                          AS channel_a,
              argMin(source, timestamp)                           AS source_a,
              argMin(referrer_host, timestamp)                    AS referrer_host_a,
              argMax(country, timestamp)                          AS country_a,
              argMax(city, timestamp)                             AS city_a,
              argMax(device_type, timestamp)                      AS device_type_a,
              argMax(browser, timestamp)                          AS browser_a,
              argMax(os, timestamp)                               AS os_a,
              toUInt8(max(props_num['scroll_depth']))             AS max_scroll_a,
              countIf(name = '$rage_click')                       AS rage_clicks_a,
              countIf(name = '$error')                            AS errors_a,
              round(sum(ifNull(toFloat64(revenue), 0)), 4)        AS revenue_a,
              pageviews_a <= 1 AND events_a <= 2                  AS is_bounce_a
          FROM ${EVENTS}
          WHERE ${scope.sql} ${personClause}
          GROUP BY session_id
      )
      ORDER BY started_at DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params,
  };
}

export function sessionList(
  client: ClickHouseClient,
  options: QueryScope & { personId?: string; limit?: number; offset?: number },
): Promise<SessionRow[]> {
  return runQuery<SessionRow>(client, buildSessionList(options));
}

export interface SessionEventRow {
  event_id: string;
  timestamp: string;
  name: string;
  path: string;
  title: string;
  duration_ms: number;
  props_raw: string;
}

/** Every event in one session, oldest first — the session replay in text form. */
export function buildSessionEvents(options: {
  sessionId: string;
  projectIds: number[];
  limit?: number;
}): BuiltQuery {
  const limit = clampLimit(options.limit, 500, 2000);
  return {
    sql: `
      SELECT
          toString(event_id) AS event_id,
          timestamp,
          name,
          path,
          title,
          duration_ms,
          props_raw
      FROM ${EVENTS}
      WHERE session_id = {sessionId:UUID}
        AND has({projectIds:Array(UInt32)}, project_id)
      ORDER BY timestamp ASC
      LIMIT {limit:UInt32}
    `,
    params: { sessionId: options.sessionId, projectIds: options.projectIds, limit },
  };
}

export function sessionEvents(
  client: ClickHouseClient,
  options: { sessionId: string; projectIds: number[]; limit?: number },
): Promise<SessionEventRow[]> {
  return runQuery<SessionEventRow>(client, buildSessionEvents(options));
}

/**
 * Sessions that ended within the given window, for the sessionizer worker.
 * "Closed" means no activity for longer than the session timeout.
 */
export function buildClosedSessions(options: {
  projectIds: number[];
  idleSince: number;
  notBefore: number;
  limit?: number;
}): BuiltQuery {
  const limit = clampLimit(options.limit, 5000, 20000);
  return {
    sql: `
      SELECT
          session_id_a    AS session_id,
          person_id_a     AS person_id,
          distinct_id_a   AS distinct_id,
          project_id_a    AS project_id,
          started_at_a    AS started_at,
          ended_at_a      AS ended_at,
          duration_sec_a  AS duration_sec,
          pageviews_a     AS pageviews,
          events_a        AS events,
          entry_path_a    AS entry_path,
          exit_path_a     AS exit_path,
          channel_a       AS channel,
          source_a        AS source,
          referrer_host_a AS referrer_host,
          utm_campaign_a  AS utm_campaign,
          country_a       AS country,
          region_a        AS region,
          city_a          AS city,
          device_type_a   AS device_type,
          browser_a       AS browser,
          os_a            AS os,
          revenue_a       AS revenue
      FROM (
          SELECT
              toString(session_id)                               AS session_id_a,
              toString(any(person_id))                           AS person_id_a,
              -- The device id, needed to register the person's alias in the
              -- identity graph on first sight.
              any(distinct_id)                                   AS distinct_id_a,
              any(project_id)                                    AS project_id_a,
              min(timestamp)                                     AS started_at_a,
              max(timestamp)                                     AS ended_at_a,
              dateDiff('second', min(timestamp), max(timestamp)) AS duration_sec_a,
              countIf(name = '$pageview')                        AS pageviews_a,
              count()                                            AS events_a,
              argMin(path, timestamp)                            AS entry_path_a,
              argMax(path, timestamp)                            AS exit_path_a,
              argMin(channel, timestamp)                         AS channel_a,
              argMin(source, timestamp)                          AS source_a,
              argMin(referrer_host, timestamp)                   AS referrer_host_a,
              argMin(utm_campaign, timestamp)                    AS utm_campaign_a,
              argMax(country, timestamp)                         AS country_a,
              argMax(region, timestamp)                          AS region_a,
              argMax(city, timestamp)                            AS city_a,
              argMax(device_type, timestamp)                     AS device_type_a,
              argMax(browser, timestamp)                         AS browser_a,
              argMax(os, timestamp)                              AS os_a,
              round(sum(ifNull(toFloat64(revenue), 0)), 4)       AS revenue_a
          FROM ${EVENTS}
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND timestamp >= {notBefore:DateTime64(3)}
            AND is_bot = 0
          GROUP BY session_id
          HAVING max(timestamp) < {idleSince:DateTime64(3)}
      )
      ORDER BY ended_at DESC
      LIMIT {limit:UInt32}
    `,
    params: {
      projectIds: options.projectIds,
      idleSince: chDateTime(options.idleSince),
      notBefore: chDateTime(options.notBefore),
      limit,
    },
  };
}

export interface ClosedSessionRow {
  session_id: string;
  person_id: string;
  distinct_id: string;
  project_id: number;
  started_at: string;
  ended_at: string;
  duration_sec: number;
  pageviews: number;
  events: number;
  entry_path: string;
  exit_path: string;
  channel: string;
  source: string;
  referrer_host: string;
  utm_campaign: string;
  country: string;
  region: string;
  city: string;
  device_type: string;
  browser: string;
  os: string;
  revenue: number;
}

export function closedSessions(
  client: ClickHouseClient,
  options: { projectIds: number[]; idleSince: number; notBefore: number; limit?: number },
): Promise<ClosedSessionRow[]> {
  return runQuery<ClosedSessionRow>(client, buildClosedSessions(options));
}
