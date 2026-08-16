import type { Interval, TrendPoint } from "@falorb/queries";
import { parseClickHouseDate } from "./format";

/**
 * Turning trend rows into chart-ready arrays.
 *
 * The query layer returns one row per bucket *that has data*. Feeding those
 * rows to a chart directly draws a line where the x-axis is "buckets that
 * happened to have traffic", so a quiet weekend silently disappears and the
 * remaining points slide together — the chart looks smooth and is wrong. Every
 * function here builds the complete bucket grid first and fills the gaps with
 * zero, which is what actually happened.
 *
 * Buckets are matched by normalised timestamp rather than by string equality,
 * because ClickHouse renders a `Date` bucket as "2026-08-16" and a `DateTime`
 * bucket as "2026-08-16 00:00:00" depending on the interval.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

export interface BucketGrid {
  /** Bucket start timestamps, ascending. */
  keys: number[];
  /** Axis labels, one per key. */
  labels: string[];
}

/** Build the full bucket sequence covering a range. */
export function bucketGrid(
  range: { from: number; to: number },
  interval: Interval,
): BucketGrid {
  const keys: number[] = [];
  let cursor = floorTo(range.from, interval);
  const end = range.to;

  // Bounded so a bad range cannot spin: a year of hours is 8,760 buckets, and
  // anything past that is a caller error rather than a chart.
  for (let guard = 0; cursor < end && guard < 10_000; guard++) {
    keys.push(cursor);
    cursor = advance(cursor, interval);
  }

  return { keys, labels: keys.map((key) => labelFor(key, interval)) };
}

/**
 * Align a single-series trend onto a grid, zero-filling missing buckets.
 *
 * Both sides are normalised with the same `floorTo`, so a bucket rendered as
 * "2026-08-16" and one rendered as "2026-08-16 00:00:00" land on the same key
 * and the lookup is a plain exact match.
 */
export function seriesFromTrend(
  points: TrendPoint[],
  keys: number[],
  interval: Interval,
): number[] {
  const byBucket = new Map<number, number>();
  for (const point of points) {
    const stamp = floorTo(parseClickHouseDate(point.bucket).getTime(), interval);
    byBucket.set(stamp, (byBucket.get(stamp) ?? 0) + Number(point.value ?? 0));
  }
  return keys.map((key) => byBucket.get(key) ?? 0);
}

/** Split a breakdown trend into one zero-filled array per series. */
export function seriesByName(
  points: TrendPoint[],
  keys: number[],
  interval: Interval,
): { name: string; data: number[] }[] {
  const grouped = new Map<string, TrendPoint[]>();
  for (const point of points) {
    const list = grouped.get(point.series) ?? [];
    list.push(point);
    grouped.set(point.series, list);
  }

  return [...grouped.entries()]
    .map(([name, rows]) => ({ name, data: seriesFromTrend(rows, keys, interval) }))
    // Largest series first, so the glacier accent lands on the one in focus.
    .sort((a, b) => sum(b.data) - sum(a.data));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function floorTo(stamp: number, interval: Interval): number {
  const date = new Date(stamp);
  switch (interval) {
    case "hour":
      return Math.floor(stamp / HOUR) * HOUR;
    case "week": {
      const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      // ISO weeks start Monday; getUTCDay() puts Sunday at 0.
      const offset = (day.getUTCDay() + 6) % 7;
      return day.getTime() - offset * DAY;
    }
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    default:
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
}

function advance(stamp: number, interval: Interval): number {
  const date = new Date(stamp);
  switch (interval) {
    case "hour":
      return stamp + HOUR;
    case "week":
      return stamp + 7 * DAY;
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    default:
      return stamp + DAY;
  }
}

function labelFor(stamp: number, interval: Interval): string {
  const date = new Date(stamp);
  switch (interval) {
    case "hour":
      return new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      }).format(date);
    case "month":
      return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
    default:
      return new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(date);
  }
}
