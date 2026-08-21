import { envCredentials, type AiCredentials } from "./credentials";
import { AiTransportError, callModel } from "./transport";
import type { ChatMessage, ChatResult, ToolSpec } from "./types";

export type { ChatMessage, ChatResult, ChatUsage, ToolCall, ToolSpec } from "./types";

/**
 * Tool-calling chat, the primitive `@falorb/agents` runs its loop on.
 *
 * Separate from `complete()` in `index.ts` rather than an option on it,
 * because they are different shapes of interaction, not one with a flag.
 * `complete()` is a single question with a prose answer and no memory —
 * every existing caller (signals, digests, drafts) wants exactly that.
 * This one carries a growing transcript, may answer with an action instead
 * of words, and reports what it cost. Folding them together would push a
 * `tool_calls` branch into four call sites that will never take it.
 *
 * Which gateway answers, and whose key pays for it, is `credentials` —
 * the organization's own connection when it has one, the deployment's
 * `OPENROUTER_API_KEY` when it hasn't. `transport.ts` owns the difference
 * between the two gateways' protocols; nothing here or above it needs to.
 */

export class AiChatError extends Error {}

export interface ChatOptions {
  tools?: ToolSpec[];
  /** Overrides the connection's (or `OPENROUTER_MODEL`'s) model for this call. */
  model?: string | null;
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
  /**
   * The organization's own AI connection. Omitted or null falls back to the
   * deployment-wide `OPENROUTER_API_KEY` — which is what every caller did
   * before organizations could bring their own.
   */
  credentials?: AiCredentials | null;
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const credentials = opts.credentials ?? envCredentials();
  if (!credentials) {
    throw new AiChatError(
      "AI agents are not configured — connect OpenRouter or Ramp Router in " +
        "Settings → Integrations, or set OPENROUTER_API_KEY.",
    );
  }

  try {
    return await callModel(credentials, {
      messages,
      tools: opts.tools,
      model: opts.model,
      maxTokens: opts.maxTokens ?? 2000,
      temperature: opts.temperature,
      timeoutMs: opts.timeoutMs ?? 90_000,
    });
  } catch (error) {
    if (error instanceof AiTransportError) throw new AiChatError(error.message);
    throw error;
  }
}
