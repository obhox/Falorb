import type { DateRange } from "./base";

/**
 * Flexible date-range parsing for tool arguments.
 *
 * An assistant asked "how did the blog do last week" will reach for a phrase,
 * not two ISO timestamps. Accepting shorthand means the model gets the range
 * right on the first call instead of guessing at a timestamp format, being
 * rejected, and retrying — which costs a round-trip and often a wrong answer.
 *
 * Lives here rather than in `apps/mcp`, where it was written, because two
 * separate model-facing surfaces now parse ranges — the MCP server and the
 * agent runtime's analytics tools. Two parsers would eventually disagree
 * about what "7d" means, and an agent and an assistant reporting different
 * numbers for the same phrase is a bug nobody would think to look for here.
 */

export class RangeError extends Error {}

const SHORTHAND = /^(\d+)([hdwmy])$/;

export interface ParsedRange extends DateRange {
  /** Human-readable label, echoed back so the model can state what it measured. */
  label: string;
}

/**
 * Parse a range expression.
 *
 * Accepted forms:
 *   "today" | "yesterday" | "mtd" | "ytd" | "all"
 *   "24h" | "7d" | "4w" | "3m" | "1y"
 *   "2026-08-01..2026-08-16"   (inclusive start, exclusive end)
 */
export function parseRange(input: string | undefined, now: number = Date.now()): ParsedRange {
  const raw = (input ?? "30d").trim().toLowerCase();
  const startOfDay = (ts: number) => {
    const d = new Date(ts);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  };

  if (raw === "today") {
    return { from: startOfDay(now), to: now, label: "today" };
  }
  if (raw === "yesterday") {
    const start = startOfDay(now) - 86_400_000;
    return { from: start, to: start + 86_400_000, label: "yesterday" };
  }
  if (raw === "mtd") {
    const d = new Date(now);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return { from: start, to: now, label: "month to date" };
  }
  if (raw === "ytd") {
    const start = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
    return { from: start, to: now, label: "year to date" };
  }
  if (raw === "all") {
    // Five years back is effectively "everything" given the 25-month event TTL,
    // while still giving ClickHouse a bounded partition range to prune against.
    return { from: now - 5 * 365 * 86_400_000, to: now, label: "all time" };
  }

  const explicit = raw.split("..");
  if (explicit.length === 2) {
    const from = Date.parse(explicit[0]!);
    const to = Date.parse(explicit[1]!);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new RangeError(`could not parse date range "${input}" — use YYYY-MM-DD..YYYY-MM-DD`);
    }
    if (to <= from) throw new RangeError("range end must be after its start");
    return { from, to, label: `${explicit[0]} to ${explicit[1]}` };
  }

  const match = SHORTHAND.exec(raw);
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2]!;
    if (amount < 1) throw new RangeError("range amount must be at least 1");

    const ms =
      unit === "h"
        ? 3_600_000
        : unit === "d"
          ? 86_400_000
          : unit === "w"
            ? 7 * 86_400_000
            : unit === "m"
              ? 30 * 86_400_000
              : 365 * 86_400_000;

    const span = amount * ms;
    // Guard rather than let an absurd range become a full-history scan.
    if (span > 5 * 365 * 86_400_000) throw new RangeError("range cannot exceed 5 years");

    const names: Record<string, string> = { h: "hour", d: "day", w: "week", m: "month", y: "year" };
    return {
      from: now - span,
      to: now,
      label: `last ${amount} ${names[unit]}${amount === 1 ? "" : "s"}`,
    };
  }

  throw new RangeError(
    `could not parse range "${input}". Use e.g. "7d", "24h", "3m", "today", "yesterday", "mtd", "ytd", or "2026-08-01..2026-08-16".`,
  );
}

/** Description reused across every tool's `range` argument. */
export const RANGE_DESCRIPTION =
  'Time window. Shorthand like "24h", "7d", "4w", "3m", "1y"; or "today", "yesterday", "mtd", "ytd", "all"; or an explicit "YYYY-MM-DD..YYYY-MM-DD". Defaults to "30d".';
