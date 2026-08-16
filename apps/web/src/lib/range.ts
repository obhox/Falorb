import type { DateRange, Interval } from "@falorb/queries";

/**
 * The date range every screen is scoped by.
 *
 * Ranges are half-open `[from, to)` in epoch milliseconds, matching what the
 * query layer expects. They are derived from the URL rather than held in
 * component state so that a range is shareable, survives a reload, and is
 * available to server components without a round-trip.
 *
 * Shared by server and client — the range picker builds the same hrefs the
 * server parses.
 */

export const RANGE_PRESETS = [
  { key: "24h", label: "24 hours", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "12m", label: "12 months", days: 365 },
] as const;

export type RangePresetKey = (typeof RANGE_PRESETS)[number]["key"];

export const DEFAULT_RANGE: RangePresetKey = "30d";

export interface ResolvedRange {
  key: RangePresetKey | "custom";
  label: string;
  range: DateRange;
  /** The immediately preceding window of equal length, for deltas. */
  previous: DateRange;
  /** Bucket width the charts should use unless a screen overrides it. */
  interval: Interval;
}

const DAY = 86_400_000;

/**
 * Parse `?range=30d` or `?from=…&to=…` into a resolved window.
 *
 * `now` is passed in rather than read from the clock so that a page render and
 * anything it triggers agree on where "now" is. Two components each calling
 * Date.now() a few milliseconds apart would produce two slightly different
 * ranges and, with them, two subtly different totals on the same screen.
 */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  now: number = Date.now(),
): ResolvedRange {
  const from = toEpoch(params.from);
  const to = toEpoch(params.to);

  if (from != null && to != null && to > from) {
    const span = to - from;
    return {
      key: "custom",
      label: "Custom",
      range: { from, to },
      previous: { from: from - span, to: from },
      interval: intervalFor(span),
    };
  }

  const preset =
    RANGE_PRESETS.find((p) => p.key === params.range) ??
    RANGE_PRESETS.find((p) => p.key === DEFAULT_RANGE)!;

  const span = preset.days * DAY;
  const end = now;
  const start = end - span;

  return {
    key: preset.key,
    label: preset.label,
    range: { from: start, to: end },
    previous: { from: start - span, to: start },
    interval: intervalFor(span),
  };
}

/**
 * Bucket width for a span.
 *
 * The query layer has its own `autoInterval`; this exists so the axis labels
 * and the range picker can agree on granularity before any query runs.
 */
export function intervalFor(spanMs: number): Interval {
  if (spanMs <= 2 * DAY) return "hour";
  if (spanMs <= 95 * DAY) return "day";
  if (spanMs <= 400 * DAY) return "week";
  return "month";
}

/** Build a href that keeps every other search param intact. */
export function rangeHref(
  pathname: string,
  current: URLSearchParams | Readonly<URLSearchParams>,
  key: RangePresetKey,
): string {
  const next = new URLSearchParams(current.toString());
  next.set("range", key);
  // A preset supersedes any custom bounds that were set.
  next.delete("from");
  next.delete("to");
  return next.size ? `${pathname}?${next.toString()}` : pathname;
}

/** Search params as plain strings, from Next's `searchParams` promise. */
export type SearchParams = Record<string, string | string[] | undefined>;

export function one(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function toEpoch(value: string | undefined): number | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && value.trim() !== "") return asNumber;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
