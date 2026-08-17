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
 * Person-level queries — the event side of a profile.
 *
 * The mutable half of a profile (traits, company, interest scores, lifetime
 * totals) lives in Postgres; everything here is the behavioural half read from
 * ClickHouse. The dashboard joins the two on person_id.
 */

export interface PersonSummaryRow {
  person_id: string;
  first_seen: string;
  last_seen: string;
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
  first_channel: string;
  first_source: string;
  first_path: string;
  last_path: string;
  countries: string[];
  devices: string[];
  /** Projects this person has been seen on — the cross-portfolio answer. */
  project_ids: number[];
}

/**
 * List people with their behavioural summary.
 *
 * Ordered by last activity, which is what makes the list useful as a "who is
 * engaging right now" view rather than an alphabetical directory.
 */
export function buildPersonList(
  options: QueryScope & { limit?: number; offset?: number },
): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 50, 500);
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  return {
    // Suffixed inner aliases, renamed outside — see the note in sessions.ts:
    // aliasing an aggregate to a real column name breaks the WHERE clause.
    sql: `
      SELECT
          person_id_a     AS person_id,
          first_seen_a    AS first_seen,
          last_seen_a     AS last_seen,
          sessions_a      AS sessions,
          pageviews_a     AS pageviews,
          events_a        AS events,
          revenue_a       AS revenue,
          first_channel_a AS first_channel,
          first_source_a  AS first_source,
          first_path_a    AS first_path,
          last_path_a     AS last_path,
          countries_a     AS countries,
          devices_a       AS devices,
          project_ids_a   AS project_ids
      FROM (
          SELECT
              toString(person_id)                     AS person_id_a,
              min(timestamp)                          AS first_seen_a,
              max(timestamp)                          AS last_seen_a,
              uniqCombined64(session_id)              AS sessions_a,
              countIf(name = '$pageview')             AS pageviews_a,
              count()                                 AS events_a,
              round(sum(ifNull(toFloat64(revenue), 0)), 4) AS revenue_a,
              argMin(channel, timestamp)              AS first_channel_a,
              argMin(source, timestamp)               AS first_source_a,
              argMin(path, timestamp)                 AS first_path_a,
              argMax(path, timestamp)                 AS last_path_a,
              arrayFilter(x -> x != '', groupUniqArray(country))     AS countries_a,
              arrayFilter(x -> x != '', groupUniqArray(device_type)) AS devices_a,
              groupUniqArray(project_id)              AS project_ids_a
          FROM ${EVENTS}
          WHERE ${scope.sql}
          GROUP BY person_id
      )
      ORDER BY last_seen DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    params: { ...scope.params, limit, offset },
  };
}

export function personList(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number; offset?: number },
): Promise<PersonSummaryRow[]> {
  return runQuery<PersonSummaryRow>(client, buildPersonList(options));
}

export interface PersonTimelineRow {
  event_id: string;
  timestamp: string;
  name: string;
  path: string;
  url: string;
  title: string;
  host: string;
  project_id: number;
  session_id: string;
  channel: string;
  source: string;
  referrer_host: string;
  country: string;
  city: string;
  device_type: string;
  browser: string;
  os: string;
  duration_ms: number;
  revenue: number | null;
  props_raw: string;
}

/**
 * The full chronological timeline for one person, across every project they
 * have touched.
 *
 * Cheap despite reading the firehose: person_id carries a bloom filter skip
 * index at GRANULARITY 1, so this is a short seek rather than a partition scan.
 *
 * Note this deliberately does not take the project scope — the whole point of
 * a profile is to show that someone read the blog, then signed up for a
 * different product.
 */
export function buildPersonTimeline(options: {
  personId: string;
  projectIds: number[];
  before?: number;
  limit?: number;
}): BuiltQuery {
  const limit = clampLimit(options.limit, 200, 1000);
  const params: Record<string, unknown> = {
    personId: options.personId,
    projectIds: options.projectIds,
    limit,
  };

  let beforeClause = "";
  if (options.before) {
    params.before = chDateTime(options.before);
    beforeClause = "AND timestamp < {before:DateTime64(3)}";
  }

  return {
    sql: `
      SELECT
          toString(event_id)    AS event_id,
          timestamp,
          name,
          path,
          url,
          title,
          host,
          project_id,
          toString(session_id)  AS session_id,
          channel,
          source,
          referrer_host,
          country,
          city,
          device_type,
          browser,
          os,
          duration_ms,
          revenue,
          props_raw
      FROM ${EVENTS}
      WHERE person_id = {personId:UUID}
        AND has({projectIds:Array(UInt32)}, project_id)
        ${beforeClause}
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}
    `,
    params,
  };
}

export function personTimeline(
  client: ClickHouseClient,
  options: { personId: string; projectIds: number[]; before?: number; limit?: number },
): Promise<PersonTimelineRow[]> {
  return runQuery<PersonTimelineRow>(client, buildPersonTimeline(options));
}

export interface PersonProjectUsage {
  project_id: number;
  first_seen: string;
  last_seen: string;
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
  top_paths: string[];
}

/**
 * Which of the organization's products this person has used, and how much.
 *
 * This is the legitimate answer to "has this person used my other platforms" —
 * derived entirely from first-party activity on properties the organization
 * owns, and only for a person whose identity was unified deterministically
 * (same identify() id, or a cross-domain link click).
 */
export function buildPersonProjects(options: {
  personId: string;
  projectIds: number[];
}): BuiltQuery {
  return {
    sql: `
      SELECT
          project_id,
          min(timestamp)                          AS first_seen,
          max(timestamp)                          AS last_seen,
          uniqCombined64(session_id)              AS sessions,
          countIf(name = '$pageview')             AS pageviews,
          count()                                 AS events,
          round(sum(ifNull(toFloat64(revenue), 0)), 4) AS revenue,
          -- topK is an approximate "most frequent values" aggregate; exact
          -- ranking of a person's five most-viewed pages is not worth a
          -- groupArray of their entire history.
          topK(5)(path)                           AS top_paths
      FROM ${EVENTS}
      WHERE person_id = {personId:UUID}
        AND has({projectIds:Array(UInt32)}, project_id)
        AND name = '$pageview'
      GROUP BY project_id
      ORDER BY last_seen DESC
    `,
    params: { personId: options.personId, projectIds: options.projectIds },
  };
}

export function personProjects(
  client: ClickHouseClient,
  options: { personId: string; projectIds: number[] },
): Promise<PersonProjectUsage[]> {
  return runQuery<PersonProjectUsage>(client, buildPersonProjects(options));
}

export interface AcquisitionTouch {
  session_id: string;
  started_at: string;
  channel: string;
  source: string;
  referrer_host: string;
  utm_campaign: string;
  utm_source: string;
  utm_medium: string;
  landing_path: string;
  project_id: number;
}

/**
 * Every acquisition touch for a person, oldest first.
 *
 * This is the referrer/UTM chain: the complete list of sites and campaigns
 * that ever sent this person to one of the organization's properties. It is
 * the browser-volunteered view of "which other sites are they on" — the only
 * such view a first-party tool can legitimately have.
 */
export function buildAcquisitionChain(options: {
  personId: string;
  projectIds: number[];
  limit?: number;
}): BuiltQuery {
  const limit = clampLimit(options.limit, 100, 500);
  return {
    sql: `
      SELECT
          session_id_a    AS session_id,
          started_at_a    AS started_at,
          channel_a       AS channel,
          source_a        AS source,
          referrer_host_a AS referrer_host,
          utm_campaign_a  AS utm_campaign,
          utm_source_a    AS utm_source,
          utm_medium_a    AS utm_medium,
          landing_path_a  AS landing_path,
          project_id_a    AS project_id
      FROM (
          SELECT
              toString(session_id)             AS session_id_a,
              min(timestamp)                   AS started_at_a,
              argMin(channel, timestamp)       AS channel_a,
              argMin(source, timestamp)        AS source_a,
              argMin(referrer_host, timestamp) AS referrer_host_a,
              argMin(utm_campaign, timestamp)  AS utm_campaign_a,
              argMin(utm_source, timestamp)    AS utm_source_a,
              argMin(utm_medium, timestamp)    AS utm_medium_a,
              argMin(path, timestamp)          AS landing_path_a,
              any(project_id)                  AS project_id_a
          FROM ${EVENTS}
          WHERE person_id = {personId:UUID}
            AND has({projectIds:Array(UInt32)}, project_id)
          GROUP BY session_id
      )
      ORDER BY started_at ASC
      LIMIT {limit:UInt32}
    `,
    params: { personId: options.personId, projectIds: options.projectIds, limit },
  };
}

export function acquisitionChain(
  client: ClickHouseClient,
  options: { personId: string; projectIds: number[]; limit?: number },
): Promise<AcquisitionTouch[]> {
  return runQuery<AcquisitionTouch>(client, buildAcquisitionChain(options));
}

export interface InterestRow {
  topic: string;
  events: number;
  last_seen: string;
}

/**
 * Raw material for the interest profile: the content tags and paths this
 * person actually engaged with. The worker turns this into weighted, decayed
 * scores; this query just reports the observations.
 *
 * Reads a `content_tag` property when the site sets one, and falls back to the
 * first path segment, which is a decent proxy for section on most blogs and
 * documentation sites.
 */
export function buildPersonInterests(options: {
  personId: string;
  projectIds: number[];
  since?: number;
  limit?: number;
}): BuiltQuery {
  const limit = clampLimit(options.limit, 50, 200);
  const params: Record<string, unknown> = {
    personId: options.personId,
    projectIds: options.projectIds,
    limit,
  };

  let sinceClause = "";
  if (options.since) {
    params.since = chDateTime(options.since);
    sinceClause = "AND timestamp >= {since:DateTime64(3)}";
  }

  return {
    sql: `
      SELECT
          topic,
          count()        AS events,
          max(timestamp) AS last_seen
      FROM (
          SELECT
              timestamp,
              if(
                  props_str['content_tag'] != '',
                  props_str['content_tag'],
                  splitByChar('/', path)[2]
              ) AS topic
          FROM ${EVENTS}
          WHERE person_id = {personId:UUID}
            AND has({projectIds:Array(UInt32)}, project_id)
            AND is_bot = 0
            ${sinceClause}
      )
      WHERE topic != ''
      GROUP BY topic
      ORDER BY events DESC
      LIMIT {limit:UInt32}
    `,
    params,
  };
}

export function personInterests(
  client: ClickHouseClient,
  options: { personId: string; projectIds: number[]; since?: number; limit?: number },
): Promise<InterestRow[]> {
  return runQuery<InterestRow>(client, buildPersonInterests(options));
}

export interface PersonTotalsRow {
  person_id: string;
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
}

/**
 * Lifetime totals for a set of people, straight from the event store.
 *
 * The profile totals in Postgres used to be accumulated — each sessionizer run
 * added its batch to whatever was already there. That is only correct if every
 * session is folded in exactly once, which nothing guaranteed: the run window
 * deliberately overlaps so a session closing on the boundary is not missed, and
 * a crash between the ClickHouse read and the Postgres write replays the batch.
 * Both double-count, and an accumulator never recovers from either.
 *
 * Recomputing makes the totals a projection of the event store rather than a
 * running tally. It costs one grouped scan per batch, it is idempotent, and it
 * repairs any drift that has already occurred on the next run.
 *
 * Bots are excluded, matching every other metric in the product.
 */
export function buildPersonTotals(options: {
  personIds: string[];
  projectIds: number[];
}): BuiltQuery {
  return {
    // Suffixed inner aliases, renamed outside — the same hazard sessions.ts
    // documents. `toString(person_id) AS person_id` shadows the real column, so
    // the WHERE clause resolves person_id to the String alias and comparing it
    // against a UUID array fails with "no supertype for types UUID, String".
    sql: `
      SELECT
          person_id_a  AS person_id,
          sessions_a   AS sessions,
          pageviews_a  AS pageviews,
          events_a     AS events,
          revenue_a    AS revenue
      FROM (
          SELECT
              toString(person_id)                          AS person_id_a,
              uniqCombined64(session_id)                   AS sessions_a,
              countIf(name = '$pageview')                  AS pageviews_a,
              count()                                      AS events_a,
              round(sum(ifNull(toFloat64(revenue), 0)), 4) AS revenue_a
          FROM ${EVENTS}
          WHERE has({projectIds:Array(UInt32)}, project_id)
            -- Mapped through toUUID rather than declared Array(UUID): the ids
            -- arrive as JS strings, and this keeps the comparison
            -- UUID-to-UUID so the column's index stays usable.
            AND has(arrayMap(x -> toUUID(x), {personIds:Array(String)}), person_id)
            AND is_bot = 0
          GROUP BY person_id
      )
    `,
    params: { personIds: options.personIds, projectIds: options.projectIds },
  };
}

export function personTotals(
  client: ClickHouseClient,
  options: { personIds: string[]; projectIds: number[] },
): Promise<PersonTotalsRow[]> {
  if (!options.personIds.length) return Promise.resolve([]);
  return runQuery<PersonTotalsRow>(client, buildPersonTotals(options));
}
