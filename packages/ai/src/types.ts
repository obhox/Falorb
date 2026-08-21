/**
 * The one conversation shape every caller works in, independent of which
 * gateway (and therefore which wire protocol — see `credentials.ts`)
 * actually answers. `transport.ts` translates these into OpenAI chat
 * completions or OpenAI responses and translates the answer back.
 *
 * Lives in its own module rather than in `chat.ts` so `transport.ts` can
 * import it without importing `chat.ts`, which imports `transport.ts`.
 */

/** A tool as the model sees it: a name, a description it decides from, and a
 * JSON Schema for the arguments. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the model emitted it — parsed by the caller, which
   * owns the schema and can report a validation failure back to the model as
   * a tool result rather than crashing the run. */
  argumentsJson: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  /** The gateway's own reported cost in USD when it reports one, else 0.
   * OpenRouter does (`usage.cost`); Ramp Router does not, so an agent
   * running on it shows a token count and a zero spend. Good enough to
   * enforce a budget and show a running total; not a bill. */
  costUsd: number;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  usage: ChatUsage;
  /** "stop" | "tool_calls" | "length" | other provider values. */
  finishReason: string;
}
