import type { FunnelStep } from "@falorb/queries";

/**
 * Funnel definitions travel in the URL.
 *
 * A funnel is the one screen where the reader builds the query, so the built
 * query has to be shareable — "here is the drop-off I'm talking about" is the
 * entire point of sending someone a funnel. Encoding it in the URL also means
 * the server can run it directly, with no client round-trip and no state that
 * disappears on reload.
 *
 * Format: `steps=$pageview:/pricing|signup|$revenue`, each step optionally
 * `event:path`. Deliberately readable rather than base64 — a funnel URL is
 * something people edit by hand.
 */

export const DEFAULT_STEPS: FunnelStep[] = [
  { label: "Visited", event: "$pageview" },
  { label: "Signed up", event: "signup" },
  { label: "Purchased", event: "$revenue" },
];

export const FUNNEL_MODES = ["ordered", "strict", "any"] as const;
export type FunnelMode = (typeof FUNNEL_MODES)[number];

export const MODE_LABELS: Record<FunnelMode, string> = {
  ordered: "In order",
  strict: "In order, nothing between",
  any: "Any order",
};

export interface FunnelSpec {
  steps: FunnelStep[];
  mode: FunnelMode;
  windowHours: number;
}

export function parseFunnelSpec(params: {
  steps?: string;
  mode?: string;
  window?: string;
}): FunnelSpec {
  const steps = parseSteps(params.steps);
  const windowHours = Number(params.window);

  return {
    steps: steps.length >= 2 ? steps : DEFAULT_STEPS,
    mode: (FUNNEL_MODES as readonly string[]).includes(params.mode ?? "")
      ? (params.mode as FunnelMode)
      : "ordered",
    windowHours:
      Number.isFinite(windowHours) && windowHours > 0 && windowHours <= 8760 ? windowHours : 168,
  };
}

export function serializeSteps(steps: FunnelStep[]): string {
  return steps
    .map((step) => {
      const path = pathOf(step);
      return path ? `${step.event ?? "$pageview"}:${path}` : (step.event ?? "$pageview");
    })
    .join("|");
}

/** The path condition on a step, if it has exactly one. */
export function pathOf(step: FunnelStep): string | null {
  const condition = step.filters?.[0];
  if (!condition || !("field" in condition) || condition.field !== "path") return null;
  return typeof condition.value === "string" ? condition.value : null;
}

function parseSteps(raw: string | undefined): FunnelStep[] {
  if (!raw) return [];

  return raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((part) => {
      const separator = part.indexOf(":");
      const event = (separator === -1 ? part : part.slice(0, separator)).trim();
      const path = separator === -1 ? "" : part.slice(separator + 1).trim();

      const step: FunnelStep = {
        label: path ? `${labelFor(event)} ${path}` : labelFor(event),
        event: event || "$pageview",
      };

      // The path becomes a filter condition rather than being interpolated
      // anywhere — the filter compiler binds it as a parameter.
      if (path) step.filters = [{ field: "path", op: "eq", value: path }];
      return step;
    });
}

function labelFor(event: string): string {
  if (!event.startsWith("$")) return event;
  const bare = event.slice(1).replace(/_/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}
