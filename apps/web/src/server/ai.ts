import "server-only";

/**
 * The platform's first LLM integration, via OpenRouter rather than a single
 * vendor's SDK — OpenRouter exposes an OpenAI-compatible chat-completions API,
 * so the model is just a config string (`OPENROUTER_MODEL`), swappable without
 * a code change.
 *
 * Deliberately not in `@falorb/core`: that package is documented (see its
 * `net.ts`) as pure and browser-safe, transpiled straight into the web app's
 * client bundle. A function that reads a secret API key and makes an outbound
 * network call must never live somewhere that could end up in that bundle, so
 * this stays server-only, alongside the rest of `apps/web/src/server`.
 */

export type SignalKind = "content" | "sales" | "marketing" | "product";

const SYSTEM_PROMPTS: Record<SignalKind, string> = {
  content:
    "You are a growth advisor for someone who personally operates several " +
    "independent web properties. You are given page-performance and " +
    "audience-interest data for one property, covering a specific date range. " +
    "Write a short, concrete recommendation — three to five sentences — on " +
    "what content to prioritize next, and mention anything currently working " +
    "well that is worth reinforcing. Do not restate the numbers back as " +
    "prose; the reader already sees the numbers next to your answer. Say " +
    "what to do and why, citing specific pages or topics from the data.",
  sales:
    "You are a sales advisor helping someone prioritize outreach across " +
    "their own businesses. Given cross-property visitor and lead activity, " +
    "recommend who to contact next and why, in three to five sentences.",
  marketing:
    "You are a marketing advisor. Given channel and campaign performance " +
    "data, recommend what to double down on or cut, in three to five " +
    "sentences.",
  product:
    "You are a product advisor. Given audience interest data set against " +
    "what the property currently offers, identify the most notable gap " +
    "between what people want and what exists, in three to five sentences.",
};

export class AiSignalError extends Error {}

/**
 * Ask the configured OpenRouter model to turn already-computed analytics data
 * into a short written recommendation.
 *
 * Takes the same structured rows already shown in the calling page's panels —
 * this is a synthesis step, not a separate data source, and the prompt says so
 * explicitly so the model doesn't just re-describe the numbers.
 */
export async function generateSignal(kind: SignalKind, contextData: unknown): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new AiSignalError(
      "AI recommendations are not configured — OPENROUTER_API_KEY is missing.",
    );
  }
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPTS[kind] },
          { role: "user", content: JSON.stringify(contextData) },
        ],
        max_tokens: 400,
      }),
      // A stuck upstream call must not hang the server action indefinitely —
      // the caller is a person waiting on a button press, not a background job.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AiSignalError(
      `Could not reach OpenRouter: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    throw new AiSignalError(`OpenRouter request failed (${response.status}).`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new AiSignalError("OpenRouter returned an empty response.");
  }
  return text;
}
