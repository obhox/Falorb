/**
 * Filter AST -> parameterized ClickHouse SQL.
 *
 * This is the security boundary of the whole query layer. Filters originate
 * from saved segments, dashboard UI state, and the public API — all of it
 * ultimately user-controlled — and end up inside a WHERE clause.
 *
 * Two rules make that safe, and both are enforced structurally rather than by
 * convention:
 *
 *   1. Field names are resolved through a fixed allow-list. A field is never
 *      interpolated from input; it is looked up, and an unknown field is a
 *      hard error. This matters because a column name cannot be passed as a
 *      query parameter.
 *   2. Every value becomes a bound `{pN:Type}` parameter. No value is ever
 *      concatenated into SQL, regardless of type.
 */

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "is_set"
  | "is_not_set";

export type FilterValue = string | number | boolean | Array<string | number>;

export interface Condition {
  field: string;
  op: FilterOperator;
  value?: FilterValue;
}

export type Filter =
  | Condition
  | { and: Filter[] }
  | { or: Filter[] }
  | { not: Filter };

/** How a whitelisted field maps onto the events table. */
interface FieldSpec {
  /** SQL expression. Fixed text — never derived from user input. */
  sql: string;
  type: "String" | "Number" | "Date";
}

/**
 * Every filterable column. Adding a field here is the only way to make it
 * filterable, which keeps the attack surface reviewable in one place.
 *
 * A Map rather than a plain object, deliberately. With an object literal,
 * `FIELDS["__proto__"]` resolves to Object.prototype and `FIELDS["toString"]`
 * to a function — both truthy, so a lookup-and-check allow-list would pass
 * them through and then interpolate `undefined` into the SQL. A Map has no
 * prototype chain to walk, so unknown keys are simply absent.
 */
const FIELDS = new Map<string, FieldSpec>(Object.entries({
  event: { sql: "name", type: "String" },
  path: { sql: "path", type: "String" },
  url: { sql: "url", type: "String" },
  host: { sql: "host", type: "String" },
  title: { sql: "title", type: "String" },
  referrer: { sql: "referrer", type: "String" },
  referrer_host: { sql: "referrer_host", type: "String" },

  channel: { sql: "channel", type: "String" },
  source: { sql: "source", type: "String" },
  utm_source: { sql: "utm_source", type: "String" },
  utm_medium: { sql: "utm_medium", type: "String" },
  utm_campaign: { sql: "utm_campaign", type: "String" },
  utm_term: { sql: "utm_term", type: "String" },
  utm_content: { sql: "utm_content", type: "String" },

  browser: { sql: "browser", type: "String" },
  browser_version: { sql: "browser_version", type: "String" },
  os: { sql: "os", type: "String" },
  os_version: { sql: "os_version", type: "String" },
  device_type: { sql: "device_type", type: "String" },
  screen_w: { sql: "screen_w", type: "Number" },
  screen_h: { sql: "screen_h", type: "Number" },

  country: { sql: "country", type: "String" },
  region: { sql: "region", type: "String" },
  city: { sql: "city", type: "String" },
  language: { sql: "language", type: "String" },
  timezone: { sql: "timezone", type: "String" },
  company_domain: { sql: "company_domain", type: "String" },

  person_id: { sql: "toString(person_id)", type: "String" },
  distinct_id: { sql: "distinct_id", type: "String" },
  session_id: { sql: "toString(session_id)", type: "String" },

  /* Crawler identity. Stored on every event but excluded from visitor metrics
     by default — a breakdown by bot_name is the only way to see which agents,
     AI or otherwise, are reading the site. */
  bot_name: { sql: "bot_name", type: "String" },

  revenue: { sql: "ifNull(toFloat64(revenue), 0)", type: "Number" },
  currency: { sql: "currency", type: "String" },
  duration_ms: { sql: "duration_ms", type: "Number" },
  is_bot: { sql: "is_bot", type: "Number" },
} satisfies Record<string, FieldSpec>));

/**
 * Custom event properties, addressed as `prop:plan` or `nprop:seats`.
 *
 * The key is a bound parameter, not interpolated text, so an arbitrary
 * property name is safe even though it reaches a Map subscript.
 */
const PROP_PREFIX = "prop:";
const NUM_PROP_PREFIX = "nprop:";

export class FilterError extends Error {}

export interface CompiledFilter {
  sql: string;
  params: Record<string, unknown>;
}

interface Builder {
  params: Record<string, unknown>;
  next: number;
}

/**
 * Compile a filter tree into a WHERE fragment plus its bound parameters.
 *
 * `paramPrefix` keeps names unique when several independent filters are
 * compiled into one statement (funnel steps, for instance).
 */
export function compileFilter(filter: Filter, paramPrefix = "f"): CompiledFilter {
  const b: Builder = { params: {}, next: 0 };
  const sql = walk(filter, b, paramPrefix);
  return { sql, params: b.params };
}

export function compileFilters(filters: Filter[], paramPrefix = "f"): CompiledFilter {
  if (!filters.length) return { sql: "1", params: {} };
  return compileFilter({ and: filters }, paramPrefix);
}

function walk(filter: Filter, b: Builder, prefix: string): string {
  if ("and" in filter) {
    if (!filter.and.length) return "1";
    return "(" + filter.and.map((f) => walk(f, b, prefix)).join(" AND ") + ")";
  }
  if ("or" in filter) {
    if (!filter.or.length) return "1";
    return "(" + filter.or.map((f) => walk(f, b, prefix)).join(" OR ") + ")";
  }
  if ("not" in filter) {
    return "NOT (" + walk(filter.not, b, prefix) + ")";
  }
  return condition(filter, b, prefix);
}

function bind(b: Builder, prefix: string, type: string, value: unknown): string {
  const name = `${prefix}${b.next++}`;
  b.params[name] = value;
  return `{${name}:${type}}`;
}

function condition(c: Condition, b: Builder, prefix: string): string {
  const { expr, type } = resolveField(c.field, b, prefix);

  switch (c.op) {
    case "is_set":
      return type === "Number" ? `${expr} != 0` : `${expr} != ''`;
    case "is_not_set":
      return type === "Number" ? `${expr} = 0` : `${expr} = ''`;
  }

  if (c.value === undefined) {
    throw new FilterError(`operator "${c.op}" requires a value`);
  }

  if (c.op === "in" || c.op === "not_in") {
    if (!Array.isArray(c.value)) throw new FilterError(`operator "${c.op}" requires an array`);
    if (!c.value.length) return c.op === "in" ? "0" : "1";
    if (c.value.length > 1000) throw new FilterError(`"${c.op}" list is limited to 1000 items`);
    const chType = type === "Number" ? "Array(Float64)" : "Array(String)";
    const normalized =
      type === "Number" ? c.value.map(Number) : c.value.map((v) => String(v));
    const p = bind(b, prefix, chType, normalized);
    return c.op === "in" ? `has(${p}, ${expr})` : `NOT has(${p}, ${expr})`;
  }

  if (type === "Number") {
    const n = Number(c.value);
    if (!Number.isFinite(n)) throw new FilterError(`field "${c.field}" expects a number`);
    const p = bind(b, prefix, "Float64", n);
    switch (c.op) {
      case "eq":
        return `${expr} = ${p}`;
      case "neq":
        return `${expr} != ${p}`;
      case "gt":
        return `${expr} > ${p}`;
      case "gte":
        return `${expr} >= ${p}`;
      case "lt":
        return `${expr} < ${p}`;
      case "lte":
        return `${expr} <= ${p}`;
      default:
        throw new FilterError(`operator "${c.op}" is not valid for a numeric field`);
    }
  }

  const s = String(c.value);
  switch (c.op) {
    case "eq":
      return `${expr} = ${bind(b, prefix, "String", s)}`;
    case "neq":
      return `${expr} != ${bind(b, prefix, "String", s)}`;
    // position()/startsWith() take the needle as a parameter, so no pattern
    // metacharacter from user input is ever interpreted — unlike LIKE, where a
    // stray % would silently change the match.
    case "contains":
      return `position(lower(${expr}), lower(${bind(b, prefix, "String", s)})) > 0`;
    case "not_contains":
      return `position(lower(${expr}), lower(${bind(b, prefix, "String", s)})) = 0`;
    case "starts_with":
      return `startsWith(${expr}, ${bind(b, prefix, "String", s)})`;
    case "ends_with":
      return `endsWith(${expr}, ${bind(b, prefix, "String", s)})`;
    case "gt":
      return `${expr} > ${bind(b, prefix, "String", s)}`;
    case "gte":
      return `${expr} >= ${bind(b, prefix, "String", s)}`;
    case "lt":
      return `${expr} < ${bind(b, prefix, "String", s)}`;
    case "lte":
      return `${expr} <= ${bind(b, prefix, "String", s)}`;
    default:
      throw new FilterError(`unsupported operator "${c.op}"`);
  }
}

function resolveField(
  field: string,
  b: Builder,
  prefix: string,
): { expr: string; type: "String" | "Number" } {
  if (field.startsWith(PROP_PREFIX)) {
    const key = field.slice(PROP_PREFIX.length);
    if (!key) throw new FilterError("property name is empty");
    return { expr: `props_str[${bind(b, prefix, "String", key)}]`, type: "String" };
  }
  if (field.startsWith(NUM_PROP_PREFIX)) {
    const key = field.slice(NUM_PROP_PREFIX.length);
    if (!key) throw new FilterError("property name is empty");
    return { expr: `props_num[${bind(b, prefix, "String", key)}]`, type: "Number" };
  }

  const spec = FIELDS.get(field);
  if (!spec) throw new FilterError(`unknown filter field "${field}"`);
  return { expr: spec.sql, type: spec.type === "Number" ? "Number" : "String" };
}

/** Field names usable as a breakdown dimension, resolved the same safe way. */
export function resolveBreakdown(field: string): { expr: string; params: Record<string, unknown> } {
  const b: Builder = { params: {}, next: 0 };
  const { expr } = resolveField(field, b, "bd");
  return { expr, params: b.params };
}

export function isFilterableField(field: string): boolean {
  return (
    field.startsWith(PROP_PREFIX) || field.startsWith(NUM_PROP_PREFIX) || FIELDS.has(field)
  );
}

export const FILTERABLE_FIELDS = [...FIELDS.keys()];
