/**
 * Output formatting for MCP tool results.
 *
 * Everything a tool returns lands in the model's context window and is paid
 * for on every subsequent turn. Raw JSON is the wrong shape for that: keys
 * repeat on every row, and a 50-row result can run to thousands of tokens that
 * say almost nothing.
 *
 * Markdown tables carry the same information with the column names stated
 * once, and models read them reliably. Numbers are pre-formatted here too —
 * asking a model to divide, round and percentage-ify raw counts is a good way
 * to get arithmetic errors in an answer that looks authoritative.
 */

export interface Column<T> {
  header: string;
  /** Cell value. Return "" for empty rather than null/undefined. */
  get: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
}

const MAX_ROWS = 200;
const MAX_CELL = 120;

export function table<T>(rows: T[], columns: Column<T>[], emptyNote = "No data."): string {
  if (!rows.length) return emptyNote;

  const shown = rows.slice(0, MAX_ROWS);
  const header = `| ${columns.map((c) => c.header).join(" | ")} |`;
  const divider = `| ${columns.map((c) => (c.align === "right" ? "---:" : ":---")).join(" | ")} |`;

  const body = shown.map((row) => {
    const cells = columns.map((c) => {
      const value = c.get(row);
      if (value === null || value === undefined || value === "") return "—";
      const text = String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
      return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL - 1)}…` : text;
    });
    return `| ${cells.join(" | ")} |`;
  });

  const truncated =
    rows.length > MAX_ROWS
      ? `\n\n_Showing ${MAX_ROWS} of ${rows.length} rows. Narrow the range or add a filter to see the rest._`
      : "";

  return [header, divider, ...body].join("\n") + truncated;
}

/** Thousands separators; analytics numbers are read, not computed on. */
export function num(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function pct(value: number | string | null | undefined, digits = 1): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(digits)}%`;
}

export function money(value: number | string | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
}

export function duration(seconds: number | string | null | undefined): string {
  const s = Math.round(Number(seconds ?? 0));
  if (!Number.isFinite(s) || s <= 0) return "0s";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Relative time, which reads better than a timestamp in a profile summary. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!Number.isFinite(t)) return String(iso);
  const diff = Math.max(0, now - t);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** Period-over-period delta, expressed the way a person would say it. */
export function delta(current: number, previous: number): string {
  if (!previous) return current ? "new" : "—";
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return "flat";
  return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
}

/** Standard MCP text result. */
export function text(body: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: body }] };
}

/**
 * Error result.
 *
 * `isError` lets the client surface a failure without the model mistaking an
 * error string for data. The message is written for the model to act on —
 * stating what to do differently, not just what went wrong.
 */
export function failure(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Heading + body, so multi-section results stay legible. */
export function section(title: string, body: string): string {
  return `## ${title}\n\n${body}`;
}
