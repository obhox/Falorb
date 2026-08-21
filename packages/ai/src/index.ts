import { envCredentials, type AiCredentials } from "./credentials";
import { stripMarkdown } from "./strip-markdown";
import { AiTransportError, callModel } from "./transport";

export { resolveModel } from "./resolve-model";
export { stripMarkdown } from "./strip-markdown";
export { chat, AiChatError } from "./chat";
export type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatUsage,
  ToolCall,
  ToolSpec,
} from "./chat";
export {
  AI_PROVIDERS,
  AI_PROVIDER_BASE_URLS,
  AI_PROVIDER_DEFAULT_MODELS,
  AI_PROVIDER_LABELS,
  envCredentials,
  isAiProvider,
} from "./credentials";
export type { AiCredentials, AiProvider } from "./credentials";
export { AiGatewayClient, AiGatewayError } from "./gateway-client";
export type { GatewayModel, VerifyResult } from "./gateway-client";

/**
 * The platform's AI-gateway integration, shared by every caller that turns
 * already-computed analytics data into written text: the four AI signals
 * (`apps/web/src/server/ai.ts`), the weekly digest worker job, per-lead
 * outreach drafts, and AI-drafted content pages.
 *
 * Lives in its own package — not `@falorb/core` — because `core` is
 * documented (see its `net.ts`) as pure and browser-safe, transpiled
 * straight into the web app's client bundle. A function that reads a secret
 * API key and makes an outbound network call must never live somewhere that
 * could end up in that bundle. `@falorb/ai` is imported only from
 * server-side code (Next.js server actions/route handlers behind
 * `apps/web/src/server`, and the worker), the same boundary `@falorb/mailer`
 * already draws for `RESEND_API_KEY`.
 *
 * Which gateway answers is no longer fixed. An organization can connect its
 * own OpenRouter or Ramp Router (router.com) account in Settings →
 * Integrations and name the model it wants — see `credentials.ts` for the
 * two providers and `transport.ts` for the protocol difference between
 * them. Callers that know which organization they are acting for pass its
 * credentials; callers that do not fall back to the deployment-wide
 * `OPENROUTER_API_KEY`, which is exactly what every caller did before.
 */

export class AiSignalError extends Error {}

/**
 * Appended to every prompt below. Without it, models routinely reach for
 * markdown (headers, `**bold**`, bullet dashes) since that's the dominant
 * style in their training data for "advice" text — but callers render the
 * result as plain text, so unrendered markdown syntax shows up as literal
 * asterisks and hashes on screen rather than formatting.
 */
export const PLAIN_TEXT_INSTRUCTION =
  " Write in plain prose only — no markdown, no headers, no numbered or " +
  "bulleted lists, no bold or italic asterisks. Just sentences.";

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
    "You are a product advisor. Given audience interest data and " +
    "funnel/goal drop-off data set against what the property currently " +
    "offers, identify the most notable gap between what people want and " +
    "what exists, and where in the experience they are actually " +
    "abandoning, in three to five sentences." +
    PLAIN_TEXT_INSTRUCTION,
};

export interface CompletionOptions {
  /** Defaults to 1000 — generous relative to a 3-5 sentence answer; see
   * `generateSignal`'s original comment on why "openrouter/auto" needs headroom. */
  maxTokens?: number;
  /** Defaults to 20s — a stuck upstream call must not hang the caller indefinitely. */
  timeoutMs?: number;
  /** Defaults to true. Set false when the caller's output is itself markdown
   * (e.g. a drafted content page body) rather than dashboard prose. */
  stripMarkdown?: boolean;
  /**
   * The organization's own AI connection (see `credentials.ts`). Omitted or
   * null falls back to the deployment-wide `OPENROUTER_API_KEY` — the
   * behaviour every caller had before organizations could bring their own
   * gateway and model.
   */
  credentials?: AiCredentials | null;
}

/**
 * Ask the configured model to turn structured input into short written
 * prose. The generic building block behind `generateSignal` and any other
 * prompt-specific caller (outreach drafts, content drafts) — one request
 * path, one error-handling shape, one markdown-stripping pass, whichever
 * gateway is on the other end.
 */
export async function complete(
  systemPrompt: string,
  userContent: unknown,
  opts: CompletionOptions = {},
): Promise<string> {
  const credentials = opts.credentials ?? envCredentials();
  if (!credentials) {
    throw new AiSignalError(
      "AI recommendations are not configured — connect OpenRouter or Ramp " +
        "Router in Settings → Integrations, or set OPENROUTER_API_KEY.",
    );
  }

  let result;
  try {
    result = await callModel(credentials, {
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: typeof userContent === "string" ? userContent : JSON.stringify(userContent),
        },
      ],
      maxTokens: opts.maxTokens ?? 1000,
      timeoutMs: opts.timeoutMs ?? 20_000,
    });
  } catch (error) {
    if (error instanceof AiTransportError) throw new AiSignalError(error.message);
    throw error;
  }

  const text = result.content?.trim();
  if (!text) throw new AiSignalError("The AI gateway returned an empty response.");
  return opts.stripMarkdown === false ? text : stripMarkdown(text);
}

/**
 * Ask the configured model to turn already-computed analytics
 * data into one of the four short written recommendations shown on
 * `/p/[project]/signals`.
 *
 * Takes the same structured rows already shown in the calling page's
 * panels — this is a synthesis step, not a separate data source, and the
 * prompt says so explicitly so the model doesn't just re-describe the
 * numbers.
 */
export async function generateSignal(
  kind: SignalKind,
  contextData: unknown,
  credentials?: AiCredentials | null,
): Promise<string> {
  return complete(SYSTEM_PROMPTS[kind], contextData, { credentials });
}
