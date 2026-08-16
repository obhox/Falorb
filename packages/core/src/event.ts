import type { Channel, DeviceType } from "./events";

/**
 * The canonical, server-side event. This is the shape that travels through the
 * Redis stream and lands in the ClickHouse `events` table — column names here
 * match column names there exactly, so the writer is a straight field copy.
 *
 * Note what is absent: there is no `ip` field, and there is deliberately no
 * way to add one. Ingest hashes the address and discards the original before
 * an event is ever constructed.
 */
export interface FalorbEvent {
  projectId: number;
  eventId: string;
  /** Epoch milliseconds, UTC, already clamped for client clock skew. */
  timestamp: number;
  name: string;

  /** Raw client identifier: the device id, or the identified user id. */
  distinctId: string;
  /** Resolved person. May be superseded later by the person_overrides dictionary. */
  personId: string;
  sessionId: string;

  url: string;
  path: string;
  host: string;
  title: string;
  referrer: string;
  referrerHost: string;

  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  channel: Channel;
  /** Human-readable acquisition source, e.g. "Google", "Hacker News". */
  source: string;

  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: DeviceType;
  screenW: number;
  screenH: number;
  viewportW: number;
  viewportH: number;

  country: string;
  region: string;
  city: string;
  timezone: string;
  language: string;
  /** Autonomous system number, used to skip company lookups on consumer ISPs. */
  asn: number;
  asnOrg: string;

  /** Populated asynchronously by the enrichment worker, empty at ingest time. */
  companyDomain: string;

  /** Flattened string-valued custom properties. */
  propsStr: Record<string, string>;
  /** Flattened numeric custom properties, kept separate so ClickHouse can aggregate them. */
  propsNum: Record<string, number>;
  /** Original properties JSON, preserved verbatim for the event detail view. */
  propsRaw: string;

  revenue: number | null;
  currency: string;
  durationMs: number;

  isBot: boolean;
  botName: string;
  /** Salted, daily-rotating hash of the IP. Never the address itself. */
  ipHash: string;
  trackerVersion: string;
}

/**
 * Split a flat property bag into the typed maps ClickHouse stores.
 *
 * Numbers go to `propsNum` so `avg()`/`sum()` work without per-query casting;
 * everything else is stringified into `propsStr`. Booleans become "true"/
 * "false" rather than 1/0 — they read better in breakdowns and would otherwise
 * pollute numeric aggregations.
 */
export function splitProps(
  props: Record<string, unknown> | undefined,
): { propsStr: Record<string, string>; propsNum: Record<string, number> } {
  const propsStr: Record<string, string> = {};
  const propsNum: Record<string, number> = {};
  if (!props) return { propsStr, propsNum };

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      if (Number.isFinite(value)) propsNum[key] = value;
    } else if (typeof value === "boolean") {
      propsStr[key] = value ? "true" : "false";
    } else if (typeof value === "string") {
      propsStr[key] = value;
    } else {
      propsStr[key] = JSON.stringify(value);
    }
  }

  return { propsStr, propsNum };
}
