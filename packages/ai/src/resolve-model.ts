/**
 * Turn an `OPENROUTER_MODEL` env value into the right OpenRouter request field.
 *
 * OpenRouter's chat-completions endpoint takes either a single `model`
 * string, or a `models` array it tries in order as fallbacks if an earlier
 * one errors or has no capacity. Comma-separated env values map naturally
 * onto that array; a bare single value maps onto `model`; unset falls back
 * to `"openrouter/auto"`, OpenRouter's own per-request auto-selection —
 * letting it pick whichever model it judges best rather than this app
 * pinning one.
 */
export function resolveModel(envValue: string | undefined): { model: string } | { models: string[] } {
  const configured = (envValue ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  if (configured.length === 0) return { model: "openrouter/auto" };
  if (configured.length === 1) return { model: configured[0]! };
  return { models: configured };
}
