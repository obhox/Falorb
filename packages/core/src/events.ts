/**
 * Reserved event names. Anything the tracker emits automatically is prefixed
 * with `$` so it can never collide with a user-defined event from
 * `falorb.track()`. The dashboard uses this prefix to separate "auto-captured"
 * from "custom" events in the UI.
 */
export const AUTO_EVENTS = {
  pageview: "$pageview",
  pageleave: "$pageleave",
  sessionStart: "$session_start",
  sessionEnd: "$session_end",
  click: "$click",
  outboundClick: "$outbound_click",
  download: "$download",
  formSubmit: "$form_submit",
  scroll: "$scroll",
  rageClick: "$rage_click",
  deadClick: "$dead_click",
  error: "$error",
  webVitals: "$web_vitals",
  identify: "$identify",
  group: "$group",
  revenue: "$revenue",
} as const;

export type AutoEventName = (typeof AUTO_EVENTS)[keyof typeof AUTO_EVENTS];

/** Every auto event name, for fast membership checks during ingest. */
export const AUTO_EVENT_SET: ReadonlySet<string> = new Set(
  Object.values(AUTO_EVENTS),
);

export function isAutoEvent(name: string): boolean {
  return AUTO_EVENT_SET.has(name);
}

/**
 * Acquisition channels, derived from referrer + UTM during ingest. Kept as a
 * closed set so the column can be LowCardinality in ClickHouse and so the
 * dashboard can rely on a stable, groupable dimension.
 */
export const CHANNELS = [
  "direct",
  "organic_search",
  "paid_search",
  "organic_social",
  "paid_social",
  "email",
  "referral",
  "affiliate",
  "display",
  "video",
  "internal",
  "unknown",
] as const;

export type Channel = (typeof CHANNELS)[number];

export const DEVICE_TYPES = [
  "desktop",
  "mobile",
  "tablet",
  "tv",
  "bot",
  "unknown",
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

/**
 * Inactivity window before a session is considered closed. Matches the GA/
 * PostHog convention of 30 minutes; the sessionizer worker uses the same
 * constant so tracker-side and server-side session boundaries agree.
 */
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Max events accepted in a single ingest batch. Anything larger is rejected. */
export const MAX_BATCH_SIZE = 100;

/** Max serialized size of one event's custom properties, in bytes. */
export const MAX_PROPS_BYTES = 8 * 1024;

/**
 * Clock-skew tolerance. Client timestamps more than this far from server time
 * are clamped to server time — phones with wrong clocks would otherwise land
 * events in the wrong ClickHouse partition entirely.
 */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
