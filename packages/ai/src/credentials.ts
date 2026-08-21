/**
 * Which AI gateway a call goes to, and with whose key.
 *
 * Falorb does not host a model. Every AI feature — the four signals, the
 * weekly digest, outreach and content drafts, property profiles, UGC
 * scripts, and the agent loop — is a prompt sent to somebody else's
 * gateway. Until now that gateway was always OpenRouter on the operator's
 * own `OPENROUTER_API_KEY`, one key for the whole deployment. An
 * organization can now bring its own instead: its own account, its own
 * billing, its own choice of model, connected in Settings → Integrations
 * exactly like Exa or ElevenLabs (see `integrationConnections`).
 *
 * Two gateways are supported, and they do not speak the same protocol —
 * which is the whole reason this file names a `provider` rather than just
 * carrying a base URL and a key:
 *
 *   - OpenRouter (openrouter.ai) speaks OpenAI **chat completions**
 *     (`POST /chat/completions`, `messages`, `tool_calls`).
 *   - Ramp Router (router.com) speaks OpenAI **responses**
 *     (`POST /responses`, `input`, `function_call` output items). Its docs
 *     document `/v1/responses` and `/v1/models` and nothing else — there is
 *     no `/chat/completions` to fall back to.
 *   - Google Gemini is reached through its **OpenAI-compatibility layer**
 *     (`https://generativelanguage.googleapis.com/v1beta/openai`), which
 *     serves `/chat/completions` and `/models` in OpenAI's shapes with
 *     bearer auth — so it reuses the chat-completions half of
 *     `transport.ts` rather than needing a third translation. Google's
 *     native `generateContent` API is a different shape entirely; going in
 *     through the compatibility layer is what keeps this a base-URL-and-a-
 *     key provider like the other two.
 *
 * Gemini is the one first-party model vendor here rather than a gateway —
 * it fronts only Google's own models, where the other two front many
 * vendors'. An org that only ever wants Gemini should not have to route
 * through a middleman to reach it, or pay one. Nothing in this package
 * cares about the distinction; it is a key, a base URL, and a model id
 * either way.
 *
 * `transport.ts` is where that fork lives; everything above it works in the
 * one `ChatMessage`/`ChatResult` shape and never learns which gateway
 * answered.
 */

export type AiProvider = "openrouter" | "router" | "gemini";

export const AI_PROVIDERS: AiProvider[] = ["openrouter", "router", "gemini"];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openrouter: "OpenRouter",
  router: "Ramp Router",
  gemini: "Google Gemini",
};

/**
 * Each gateway has one fixed API root — neither is self-hosted, so unlike
 * Linki/Bund AI there is no base URL to ask the user for. Stored on the
 * connection row anyway (like Buffer's and Clay's) so the credential shape
 * stays uniform across every provider in that table.
 */
export const AI_PROVIDER_BASE_URLS: Record<AiProvider, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  router: "https://api.router.com/v1",
  // The `/openai` path under `v1beta`, not the root Google's own SDKs use:
  // the sibling `v1beta` endpoints speak `generateContent`, which is not an
  // OpenAI shape at all, so `.../v1beta` alone would 404 every request.
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/**
 * What to send when the connection names no model.
 *
 * OpenRouter has `openrouter/auto`, its own per-request model selection —
 * the platform's long-standing default, and deliberately not a pinned model
 * (see `resolveModel`). Neither of the others has an equivalent: Ramp
 * Router's callable model ids are whatever `GET /models` returns for that
 * particular key, and Gemini names a specific generation on every request.
 * `null` here means "the connect form must ask", and the UI does.
 *
 * Gemini deliberately gets `null` rather than a plausible default like
 * `gemini-2.5-flash`. With no auto-select to fall back on, a default here
 * would be this repository pinning a model — the thing `resolveModel`
 * exists not to do — and it would go stale on Google's release cadence,
 * silently, for every organization that never touched the field.
 */
export const AI_PROVIDER_DEFAULT_MODELS: Record<AiProvider, string | null> = {
  openrouter: "openrouter/auto",
  router: null,
  gemini: null,
};

export function isAiProvider(value: string): value is AiProvider {
  return value === "openrouter" || value === "router" || value === "gemini";
}

export interface AiCredentials {
  provider: AiProvider;
  /** No trailing slash. */
  baseUrl: string;
  apiKey: string;
  /**
   * The model to ask for, or null to use the provider's default. A
   * comma-separated list is a fallback chain on both gateways (see
   * `resolveModel`), though Ramp Router only accepts one whose entries are
   * provider-qualified — `routerRouteSelector` pins the first entry when they
   * are not.
   */
  model: string | null;
}

/**
 * The deployment-wide OpenRouter key from the environment — what every AI
 * feature ran on before organizations could connect their own, and still
 * the fallback for any organization that hasn't. Returns null when
 * `OPENROUTER_API_KEY` is unset, which callers turn into "AI is not
 * configured" rather than a failed request.
 */
export function envCredentials(): AiCredentials | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return {
    provider: "openrouter",
    baseUrl: AI_PROVIDER_BASE_URLS.openrouter,
    apiKey,
    model: process.env.OPENROUTER_MODEL?.trim() || null,
  };
}
