import type { FalorbEvent } from "@falorb/core";

/**
 * Mapping from the canonical event to a ClickHouse row.
 *
 * Lives next to the DDL on purpose: if a column is added in a migration, the
 * compiler points here, and the two cannot drift apart silently.
 */
export type EventRow = Record<string, unknown>;

/**
 * Format epoch milliseconds for a DateTime64(3) column.
 *
 * A bare number is ambiguous — ClickHouse reads integers as *seconds* for
 * DateTime columns, so passing milliseconds would place every event roughly
 * fifty thousand years in the future. An explicit `YYYY-MM-DD HH:MM:SS.mmm`
 * string removes the ambiguity entirely.
 */
export function formatDateTime64(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "");
}

export function toEventRow(e: FalorbEvent): EventRow {
  return {
    project_id: e.projectId,
    event_id: e.eventId,
    timestamp: formatDateTime64(e.timestamp),
    name: e.name,

    distinct_id: e.distinctId,
    person_id: e.personId,
    session_id: e.sessionId,

    url: e.url,
    path: e.path,
    host: e.host,
    title: e.title,
    referrer: e.referrer,
    referrer_host: e.referrerHost,

    utm_source: e.utmSource,
    utm_medium: e.utmMedium,
    utm_campaign: e.utmCampaign,
    utm_term: e.utmTerm,
    utm_content: e.utmContent,
    channel: e.channel,
    source: e.source,

    browser: e.browser,
    browser_version: e.browserVersion,
    os: e.os,
    os_version: e.osVersion,
    device_type: e.deviceType,
    screen_w: e.screenW,
    screen_h: e.screenH,
    viewport_w: e.viewportW,
    viewport_h: e.viewportH,

    country: e.country,
    region: e.region,
    city: e.city,
    timezone: e.timezone,
    language: e.language,
    asn: e.asn,
    asn_org: e.asnOrg,

    company_domain: e.companyDomain,

    props_str: e.propsStr,
    props_num: e.propsNum,
    props_raw: e.propsRaw,

    revenue: e.revenue,
    currency: e.currency,
    duration_ms: e.durationMs,

    // ClickHouse UInt8, not a SQL boolean.
    is_bot: e.isBot ? 1 : 0,
    bot_name: e.botName,
    ip_hash: e.ipHash,
    tracker_version: e.trackerVersion,
  };
}
