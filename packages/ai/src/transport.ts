import { AI_PROVIDER_DEFAULT_MODELS, AI_PROVIDER_LABELS, type AiCredentials } from "./credentials";
import { resolveModel } from "./resolve-model";
import type { ChatMessage, ChatResult, ToolCall, ToolSpec } from "./types";

/**
 * The one place that knows a gateway's wire protocol.
 *
 * Both supported gateways (see `credentials.ts`) put many vendors' models
 * behind one key, but behind two different OpenAI-shaped APIs: OpenRouter
 * speaks chat completions, Ramp Router speaks responses. Rather than teach
 * every caller which one it is talking to, `callModel` takes the internal
 * `ChatMessage[]` shape, translates it for whichever gateway the
 * organization connected, and translates the answer back into one
 * `ChatResult`. `chat()` and `complete()` are both thin wrappers over it.
 *
 * Errors all surface as `AiTransportError`; the two wrappers re-throw them
 * as `AiChatError`/`AiSignalError` so the existing error handling at every
 * call site keeps working unchanged.
 */

export class AiTransportError extends Error {}

export interface ModelRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  temperature?: number;
  timeoutMs: number;
  /** Overrides the connection's model for this one call. */
  model?: string | null;
}

export async function callModel(credentials: AiCredentials, request: ModelRequest): Promise<ChatResult> {
  return credentials.provider === "router"
    ? callResponses(credentials, request)
    : callChatCompletions(credentials, request);
}

/**
 * The model id(s) to ask for: the per-call override, else the connection's,
 * else the provider's default. Ramp Router has no default (its callable ids
 * are key-specific), so a connection to it that names no model is a
 * configuration error worth saying plainly rather than a request that fails
 * upstream with a less obvious message.
 */
function requireModel(credentials: AiCredentials, override: string | null | undefined): string {
  const model = (override ?? credentials.model ?? AI_PROVIDER_DEFAULT_MODELS[credentials.provider] ?? "").trim();
  if (!model) {
    throw new AiTransportError(
      `No model is set for the ${AI_PROVIDER_LABELS[credentials.provider]} connection — ` +
        "choose one in Settings → Integrations.",
    );
  }
  return model;
}

async function post(credentials: AiCredentials, path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const label = AI_PROVIDER_LABELS[credentials.provider];

  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new AiTransportError(
      `Could not reach ${label}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401 || response.status === 403) {
      throw new AiTransportError(`${label} rejected the API key (${response.status}).`);
    }
    if (response.status === 402) {
      throw new AiTransportError(`${label} rejected the request: insufficient credits.`);
    }
    throw new AiTransportError(
      `${label} request failed (${response.status}).${detail ? ` ${detail.slice(0, 300)}` : ""}`,
    );
  }

  return response.json();
}

/* ------------------------------------------------------------------ *
 * OpenAI chat completions — OpenRouter
 * ------------------------------------------------------------------ */

interface ChatCompletionsChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string;
}

/**
 * Two request details are load-bearing and easy to lose in a refactor.
 *
 * `provider.require_parameters` is sent whenever tools are, and it is what
 * makes running on `openrouter/auto` — the platform default, and the
 * deliberate choice for agents — safe. Auto picks a model per request, and
 * not every model it might pick supports function calling. Without this
 * flag an agent silently degrades into one that writes prose *about* the
 * action it would have taken, which reads as a bad agent rather than a
 * misrouted request. With it, OpenRouter only considers models that honour
 * every parameter sent, so auto keeps its advantage — no pinned model to go
 * stale, no per-deployment model list to maintain — without the failure
 * mode.
 *
 * `usage.include` asks OpenRouter to return what the call actually cost.
 * That number is what stops a looping agent from being discovered on an
 * invoice.
 *
 * Both are OpenRouter extensions, so both are sent only to OpenRouter.
 */
async function callChatCompletions(credentials: AiCredentials, request: ModelRequest): Promise<ChatResult> {
  const isOpenRouter = credentials.provider === "openrouter";

  const body: Record<string, unknown> = {
    ...resolveModel(requireModel(credentials, request.model)),
    messages: request.messages.map(toChatCompletionsMessage),
    max_tokens: request.maxTokens,
  };
  if (isOpenRouter) body.usage = { include: true };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
    if (isOpenRouter) body.provider = { require_parameters: true };
  }

  const payload = (await post(credentials, "/chat/completions", body, request.timeoutMs)) as {
    choices?: ChatCompletionsChoice[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };

  // OpenRouter can answer 200 with an error body when an upstream provider
  // failed after routing — a hard failure that would otherwise read as an
  // empty response.
  if (payload.error?.message) {
    throw new AiTransportError(`${AI_PROVIDER_LABELS[credentials.provider]}: ${payload.error.message}`);
  }

  const choice = payload.choices?.[0];
  if (!choice) throw new AiTransportError(`${AI_PROVIDER_LABELS[credentials.provider]} returned no choices.`);

  const toolCalls: ToolCall[] = (choice.message?.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.function!.name!,
      argumentsJson: c.function?.arguments ?? "{}",
    }));

  return {
    content: choice.message?.content?.trim() || null,
    toolCalls,
    usage: {
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      costUsd: payload.usage?.cost ?? 0,
    },
    finishReason: choice.finish_reason ?? (toolCalls.length ? "tool_calls" : "stop"),
  };
}

/** Internal shape → OpenAI chat-completions wire shape. */
function toChatCompletionsMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, name: message.name, content: message.content };
  }
  if (message.role === "assistant") {
    const out: Record<string, unknown> = { role: "assistant", content: message.content };
    if (message.toolCalls?.length) {
      out.tool_calls = message.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.argumentsJson },
      }));
    }
    return out;
  }
  return { role: message.role, content: message.content };
}

/* ------------------------------------------------------------------ *
 * OpenAI responses — Ramp Router
 * ------------------------------------------------------------------ */

interface ResponsesOutputItem {
  type?: string;
  /** `message` items. */
  content?: Array<{ type?: string; text?: string }>;
  /** `function_call` items. */
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
}

/**
 * The responses API differs from chat completions in three ways that matter
 * here, and all three are handled below rather than papered over:
 *
 *   - the transcript is `input`, a flat list of items, and a tool call and
 *     its result are items in that list rather than fields on a message;
 *   - tools are declared flat (`{type, name, description, parameters}`),
 *     not nested under `function`;
 *   - the answer is an `output` array that mixes message items and
 *     `function_call` items, so text and tool calls are collected in one
 *     pass instead of read off a single choice.
 *
 * A model *list* has no equivalent either: `resolveModel`'s comma-separated
 * fallback chain is an OpenRouter feature, so only the first entry is sent.
 */
async function callResponses(credentials: AiCredentials, request: ModelRequest): Promise<ChatResult> {
  const resolved = resolveModel(requireModel(credentials, request.model));
  const model = "model" in resolved ? resolved.model : resolved.models[0]!;

  const body: Record<string, unknown> = {
    model,
    input: request.messages.flatMap(toResponsesInputItems),
    max_output_tokens: request.maxTokens,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    body.tool_choice = "auto";
  }

  const payload = (await post(credentials, "/responses", body, request.timeoutMs)) as {
    output?: ResponsesOutputItem[];
    output_text?: string;
    status?: string;
    incomplete_details?: { reason?: string };
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string } | null;
  };

  if (payload.error?.message) throw new AiTransportError(`Ramp Router: ${payload.error.message}`);

  const output = payload.output ?? [];

  const toolCalls: ToolCall[] = output
    .filter((item) => item.type === "function_call" && item.name)
    .map((item, i) => ({
      id: item.call_id ?? item.id ?? `call_${i}`,
      name: item.name!,
      argumentsJson: item.arguments ?? "{}",
    }));

  const text =
    payload.output_text?.trim() ||
    output
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" && part.text)
      .map((part) => part.text!)
      .join("")
      .trim();

  if (!text && toolCalls.length === 0) throw new AiTransportError("Ramp Router returned an empty response.");

  return {
    content: text || null,
    toolCalls,
    usage: {
      promptTokens: payload.usage?.input_tokens ?? 0,
      completionTokens: payload.usage?.output_tokens ?? 0,
      // Ramp Router reports no per-request cost; see `ChatUsage.costUsd`.
      costUsd: 0,
    },
    finishReason: toolCalls.length
      ? "tool_calls"
      : payload.incomplete_details?.reason === "max_output_tokens"
        ? "length"
        : (payload.status ?? "stop") === "completed"
          ? "stop"
          : (payload.status ?? "stop"),
  };
}

/** Internal shape → OpenAI responses wire shape. One message can become two
 * items: an assistant turn that both said something and called a tool. */
function toResponsesInputItems(message: ChatMessage): Array<Record<string, unknown>> {
  if (message.role === "tool") {
    return [{ type: "function_call_output", call_id: message.toolCallId, output: message.content }];
  }
  if (message.role === "assistant") {
    const items: Array<Record<string, unknown>> = [];
    if (message.content) {
      items.push({ role: "assistant", content: [{ type: "output_text", text: message.content }] });
    }
    for (const call of message.toolCalls ?? []) {
      items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.argumentsJson });
    }
    return items;
  }
  return [{ role: message.role, content: [{ type: "input_text", text: message.content }] }];
}
