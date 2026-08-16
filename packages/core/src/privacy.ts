/**
 * PII masking applied at ingest, before an event is ever written.
 *
 * The threat here is not malice, it is accident. Sites put email addresses in
 * query strings, order confirmation pages carry names in the path, a developer
 * passes a whole user object to `track()`. Analytics then quietly becomes a
 * store of personal data nobody intended to collect, and the first anyone
 * hears of it is a subject access request.
 *
 * Masking happens on the way in rather than on the way out on purpose: once
 * the raw value is in ClickHouse it is in backups, in exports, and in every
 * query result. Redacting at read time would be a filter, not a guarantee.
 */

export interface MaskingRules {
  /** Query parameters removed from stored URLs entirely. */
  stripParams: string[];
  /** Property keys whose values are replaced with a marker. */
  redactProps: string[];
  /**
   * Replace anything that looks like an email or a long number in free text.
   * On by default: the values it catches are ones no site meant to send.
   */
  scrubPatterns: boolean;
  /** Path segments matching these are replaced, e.g. /orders/abc123 -> /orders/:id */
  normalizeIds: boolean;
}

export const DEFAULT_MASKING: MaskingRules = {
  stripParams: ["email", "e-mail", "token", "password", "secret", "key", "auth", "session"],
  redactProps: [],
  scrubPatterns: true,
  normalizeIds: false,
};

export const REDACTED = "[redacted]";

export function resolveMaskingRules(settings: unknown): MaskingRules {
  const raw = (settings as { masking?: Partial<MaskingRules> } | null)?.masking;
  if (!raw) return DEFAULT_MASKING;
  return {
    stripParams: raw.stripParams ?? DEFAULT_MASKING.stripParams,
    redactProps: raw.redactProps ?? DEFAULT_MASKING.redactProps,
    scrubPatterns: raw.scrubPatterns ?? DEFAULT_MASKING.scrubPatterns,
    normalizeIds: raw.normalizeIds ?? DEFAULT_MASKING.normalizeIds,
  };
}

// Deliberately conservative. A greedy pattern that eats order numbers or
// product SKUs would destroy the analytics to protect data that was never
// personal.
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** 13+ consecutive digits: card numbers, national ids, phone numbers with prefix. */
const LONG_NUMBER = /\b\d{13,}\b/g;

export function scrubText(value: string, rules: MaskingRules): string {
  if (!rules.scrubPatterns) return value;
  return value.replace(EMAIL, REDACTED).replace(LONG_NUMBER, REDACTED);
}

/**
 * Strip sensitive query parameters and optionally normalise id-like path
 * segments.
 *
 * Returns the URL unchanged if unparseable — a malformed URL is not worth
 * throwing over on the ingest hot path.
 */
export function maskUrl(raw: string, rules: MaskingRules): string {
  if (!raw) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return scrubText(raw, rules);
  }

  const strip = new Set(rules.stripParams.map((p) => p.toLowerCase()));
  for (const key of [...url.searchParams.keys()]) {
    if (strip.has(key.toLowerCase())) url.searchParams.delete(key);
  }

  // Query values can carry an address even under an innocent parameter name.
  for (const [key, value] of [...url.searchParams.entries()]) {
    const scrubbed = scrubText(value, rules);
    if (scrubbed !== value) url.searchParams.set(key, scrubbed);
  }

  if (rules.normalizeIds) url.pathname = normalizeIdSegments(url.pathname);
  return url.toString();
}

export function maskPath(path: string, rules: MaskingRules): string {
  return rules.normalizeIds ? normalizeIdSegments(path) : path;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const HASH_SEGMENT = /^[0-9a-f]{16,}$/i;

/**
 * Collapse identifier-looking path segments so `/orders/8412` and
 * `/orders/8413` aggregate into one row.
 *
 * Off by default. It makes top-pages reports far more useful on an app, and
 * completely wrong on a blog where `/2024/11` is a real archive page — so it
 * is a per-project decision, not a default.
 */
export function normalizeIdSegments(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (UUID_SEGMENT.test(segment)) return ":uuid";
      if (NUMERIC_SEGMENT.test(segment) && segment.length >= 2) return ":id";
      if (HASH_SEGMENT.test(segment)) return ":hash";
      return segment;
    })
    .join("/");
}

/** Apply redaction and scrubbing to a flat property bag. */
export function maskProps(
  props: Record<string, unknown> | undefined,
  rules: MaskingRules,
): Record<string, unknown> | undefined {
  if (!props) return props;
  const redact = new Set(rules.redactProps.map((p) => p.toLowerCase()));
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(props)) {
    if (redact.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = typeof value === "string" ? scrubText(value, rules) : value;
  }
  return out;
}
