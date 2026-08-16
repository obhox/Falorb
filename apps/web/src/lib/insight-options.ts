/**
 * The metric, dimension and chart choices offered by `/insights`.
 *
 * These live in a plain module rather than beside the control component on
 * purpose. `InsightControls` is a `"use client"` module, and a server component
 * that imports a *value* from a client module does not get the value — it gets
 * a client reference proxy. Reading `METRICS[metric]` on the server then yields
 * `undefined`, and the first `.toLowerCase()` on it takes the whole page down
 * to the error boundary.
 *
 * That failure is invisible to the type system, which sees a perfectly good
 * `Record<string, string>` either way, so the only structural defence is
 * keeping shared constants out of client modules.
 */

export const METRICS = {
  visitors: "Unique visitors",
  sessions: "Sessions",
  pageviews: "Pageviews",
  events: "Events",
  revenue: "Revenue",
} as const;

export const DIMENSIONS = {
  channel: "Channel",
  source: "Source",
  referrer_host: "Referrer",
  utm_campaign: "Campaign",
  path: "Page",
  country: "Country",
  device_type: "Device",
  browser: "Browser",
  os: "Operating system",
  event: "Event name",
} as const;

export const CHARTS = {
  bars: "Bars",
  donut: "Donut",
  table: "Table",
} as const;

export type MetricKey = keyof typeof METRICS;
export type DimensionKey = keyof typeof DIMENSIONS;
export type ChartKey = keyof typeof CHARTS;

/** Narrow a search-param string to a known key, falling back when unrecognised. */
export function asKey<T extends Record<string, string>>(
  value: string | undefined,
  allowed: T,
  fallback: keyof T,
): keyof T {
  return value && Object.prototype.hasOwnProperty.call(allowed, value)
    ? (value as keyof T)
    : fallback;
}
