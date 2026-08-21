import type { Provider } from "@/server/actions/integrations";

/**
 * The two facts the Integrations panels need about the AI gateways, in a
 * module a client component may import.
 *
 * `@falorb/ai` is the source of truth for both (`credentials.ts`), but it is
 * server-only by design — it reads API keys and makes outbound calls, and
 * `apps/web` is not configured to transpile it into the client bundle
 * either. So these are restated here, the same way each panel already
 * restates its own LABELS/BLURBS/HAS_BASE_URL maps rather than importing
 * them across that boundary. Two entries; if a third gateway ever lands,
 * both places change together.
 */

/** Takes `string` rather than `Provider` so it works against either
 * `Provider` type in play across this boundary (the full set `@/server/
 * integrations`'s `ConnectionView` can report vs. the narrower set
 * `@/server/actions/integrations` can actively connect) without forcing a
 * cast at the call site. */
export function isAiProvider(provider: string): boolean {
  return provider === "openrouter" || provider === "router";
}

/**
 * What an unset model means for each gateway. OpenRouter has
 * `openrouter/auto`, its own per-request selection; Ramp Router has no
 * automatic model at all, so a connection there is unusable until one is
 * picked — which is why this is nullable rather than a plain string.
 */
export const AI_DEFAULT_MODELS: Partial<Record<Provider, string>> = {
  openrouter: "openrouter/auto",
};
