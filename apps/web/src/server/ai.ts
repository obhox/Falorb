import "server-only";
import { stripMarkdown } from "@/lib/strip-markdown";

/**
 * The platform's first LLM integration, via OpenRouter rather than a single
 * vendor's SDK — OpenRouter exposes an OpenAI-compatible chat-completions API,
 * so the model is just a config string, swappable without a code change. By
 * default that string is `"openrouter/auto"`: OpenRouter picks whichever
 * model it judges best for each request rather than this app pinning one.
 * `OPENROUTER_MODEL` overrides that with a specific model if ever wanted.
 *
 * Deliberately not in `@falorb/core`: that package is documented (see its
 * `net.ts`) as pure and browser-safe, transpiled straight into the web app's
 * client bundle. A function that reads a secret API key and makes an outbound
 * network call must never live somewhere that could end up in that bundle, so
 * this stays server-only, alongside the rest of `apps/web/src/server`.
 */

export type SignalKind = "content" | "sales" | "marketing" | "product";

/**
 * Appended to every prompt below. Without it, models routinely reach for
 * markdown (headers, `**bold**`, bullet dashes) since that's the dominant
 * style in their training data for "advice" text — but the panel renders
 * `body` as plain text, so unrendered markdown syntax shows up as literal
 * asterisks and hashes on screen rather than formatting.
 */
const PLAIN_TEXT_INSTRUCTION =
  " Write in plain prose only — no markdown, no headers, no numbered or " +
  "bulleted lists, no bold or italic asterisks. Just sentences.";

const SYSTEM_PROMPTS: Record<SignalKind, string> = {
  content:
    "You are a growth advisor for someone who personally operates several " +
    "independent web properties. You are given page-performance and " +
    "audience-interest data for one property, covering a specific date range. " +
    "Write a short, concrete recommendation — three to five sentences — on " +
    "what content to prioritize next, and mention anything currently working " +
    "well that is worth reinforcing. Do not restate the numbers back as " +
    "prose; the reader already sees the numbers next to your answer. Say " +
    "what to do and why, citing specific pages or topics from the data." +
    PLAIN_TEXT_INSTRUCTION,
  sales:
    "You are a sales advisor helping someone prioritize outreach across " +
    "their own businesses. Given cross-property visitor and lead activity, " +
    "recommend who to contact next and why, in three to five sentences." +
    PLAIN_TEXT_INSTRUCTION,
  marketing:
    "You are a marketing advisor. Given channel and campaign performance " +
    "data, recommend what to double down on or cut, in three to five " +
    "sentences." +
    PLAIN_TEXT_INSTRUCTION,
  product:
    "You are a product advisor. Given audience interest data set against " +
    "what the property currently offers, identify the most notable gap " +
    "between what people want and what exists, in three to five sentences." +
    PLAIN_TEXT_INSTRUCTION,
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
  // "openrouter/auto" routes each request to whichever model OpenRouter
  // judges best for it, rather than pinning one — OPENROUTER_MODEL remains
  // available as an explicit override if a specific model is ever wanted.
  const model = process.env.OPENROUTER_MODEL ?? "openrouter/auto";

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
        // Generous relative to the 3-5 sentence prompt: with "openrouter/auto"
        // picking the model per request, some candidates spend part of this
        // budget on invisible reasoning tokens before the visible answer —
        // observed live returning an empty response at 400. A tighter cap
        // that only worked for one specific model would defeat the point of
        // not pinning one.
        max_tokens: 1000,
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
  return stripMarkdown(text);
}
