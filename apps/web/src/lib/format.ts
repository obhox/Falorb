/**
 * Number and time formatting.
 *
 * The design system is explicit that values are formatted *before* they reach
 * a component: thousands separators, one decimal on percentages, the unit
 * split from the figure, a sign on every delta, and human durations rather
 * than raw seconds. Components render what they are given, so this module is
 * the only place those rules live.
 *
 * Shared by server and client, so nothing here may touch `process.env` or a
 * database. Locale is fixed to en-US so a server render and a client re-render
 * cannot disagree about separators and trigger a hydration mismatch.
 */

const LOCALE = "en-US";

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 1234567 -> "1,234,567". */
export function num(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return integer.format(Math.round(value));
}

/**
 * Compact figures for tight cells: 12.4K, 1.2M.
 *
 * Only used where a full figure genuinely will not fit — sparkline captions and
 * axis ticks. Tables always carry the exact number, because a table is where
 * someone goes to read the exact number.
 */
export function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs < 1000) return integer.format(Math.round(value));
  if (abs < 1_000_000) return `${oneDecimal.format(value / 1000)}K`;
  if (abs < 1_000_000_000) return `${oneDecimal.format(value / 1_000_000)}M`;
  return `${oneDecimal.format(value / 1_000_000_000)}B`;
}

/** 0.4271 -> "42.7%". Takes a ratio. */
export function percent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${oneDecimal.format(ratio * 100)}%`;
}

/** 42.71 -> "42.7%". Takes an already-scaled percentage. */
export function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${oneDecimal.format(value)}%`;
}

/**
 * Period-over-period change as a percentage, or null when there is no honest
 * comparison to make.
 *
 * A previous period of zero is the case that matters. "Up 100%" from nothing
 * is not a fact about growth, it is a division by zero dressed up as one, so
 * the caller gets null and renders no delta pill at all.
 */
export function delta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Always signed: "+8.7%", "-6.3%". */
export function signedPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${oneDecimal.format(Math.abs(value))}%`;
}

/** Seconds -> "1m 48s", "2h 04m", "41s". Never raw seconds. */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Milliseconds -> the same human form. */
export function durationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return duration(ms / 1000);
}

/**
 * "41m ago", "Yesterday", "12 Mar".
 *
 * Takes an explicit `now` so a server render is deterministic — passing the
 * server's clock down means the string does not change between render and
 * hydration.
 */
export function relative(when: Date | string | number, now: number = Date.now()): string {
  const then = toDate(when);
  if (!then) return "—";
  const diff = now - then.getTime();

  /**
   * Future timestamps count forward, not to "Just now".
   *
   * Not every caller is looking backwards: an invitation's expiry is always in
   * the future, and collapsing it to "Just now" told the reader that a link
   * with six days left on it had just lapsed. Clock skew between the server
   * and a client is the other source of small negative diffs, which is why the
   * sub-minute case stays vague rather than claiming "in 0s".
   */
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60_000) return "in a moment";
    if (ahead < 3_600_000) return `in ${Math.floor(ahead / 60_000)}m`;
    if (ahead < 86_400_000) return `in ${Math.floor(ahead / 3_600_000)}h`;
    if (ahead < 604_800_000) return `in ${Math.floor(ahead / 86_400_000)}d`;
    return shortDate(then, now);
  }

  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 172_800_000) return "Yesterday";
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return shortDate(then);
}

/** "12 Mar" within this year, "12 Mar 2025" otherwise. */
export function shortDate(when: Date | string | number, now: number = Date.now()): string {
  const date = toDate(when);
  if (!date) return "—";
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear();
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

/** "12 Mar, 14:08". */
export function dateTime(when: Date | string | number): string {
  const date = toDate(when);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

/** "14:08:31" — the live feed, where only the time of day is meaningful. */
export function clockTime(when: Date | string | number): string {
  const date = toDate(when);
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

/** Money, with the figure and the symbol together — currencies read as one token. */
export function money(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

/** Bytes -> "1.94 KB". Split unit from figure at the call site if needed. */
export function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${oneDecimal.format(value / 1024)} KB`;
  return `${oneDecimal.format(value / 1024 / 1024)} MB`;
}

/**
 * ClickHouse hands back `DateTime64` as "2026-08-16 09:41:12.000" with no zone
 * marker. `new Date()` reads that as local time, which silently shifts every
 * timestamp in the UI by the server's offset. Everything stored is UTC, so the
 * marker is added before parsing.
 */
export function parseClickHouseDate(value: string): Date {
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value);
  return new Date(`${value.replace(" ", "T")}Z`);
}

function toDate(when: Date | string | number): Date | null {
  const date =
    when instanceof Date
      ? when
      : typeof when === "number"
        ? new Date(when)
        : parseClickHouseDate(when);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "docs.falorb.io/pricing" — a path shown with just enough context. */
export function prettyPath(path: string | null | undefined, maxLength = 48): string {
  if (!path) return "/";
  return path.length <= maxLength ? path : `${path.slice(0, maxLength - 1)}…`;
}

/** Country codes stay as text — the design system forbids flag emoji. */
export function countryLabel(code: string | null | undefined): string {
  if (!code) return "Unknown";
  try {
    const name = new Intl.DisplayNames([LOCALE], { type: "region" }).of(code.toUpperCase());
    return name ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** `$pageview` -> `Pageview`; a custom name is left exactly as it was sent. */
export function eventLabel(name: string): string {
  if (!name.startsWith("$")) return name;
  const bare = name.slice(1).replace(/_/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** Anonymous people are identified by a short prefix of their id, in mono. */
export function personLabel(personId: string, distinctId?: string | null): string {
  if (distinctId && !isUuidLike(distinctId)) return distinctId;
  return personId.slice(0, 8);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value);
}
