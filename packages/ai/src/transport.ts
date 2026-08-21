import { AI_PROVIDER_DEFAULT_MODELS, AI_PROVIDER_LABELS, type AiCredentials } from "./credentials";
import { resolveModel } from "./resolve-model";
import type { ChatMessage, ChatResult, ToolCall, ToolSpec } from "./types";

/**
 * The one place that knows a gateway's wire protocol.
 *
 * All three supported providers (see `credentials.ts`) answer an
 * OpenAI-shaped API, but not the *same* OpenAI-shaped API: OpenRouter and
 * Gemini's compatibility layer speak chat completions, Ramp Router speaks
 * responses. Rather than teach every caller which one it is talking to,
 * `callModel` takes the internal `ChatMessage[]` shape, translates it for
 * whichever provider the organization connected, and translates the answer
 * back into one `ChatResult`. `chat()` and `complete()` are both thin
 * wrappers over it.
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
 * else the provider's default. Only OpenRouter has a default — Ramp
 * Router's callable ids are key-specific and Gemini has no auto-select — so
 * a connection to either that names no model is a configuration error worth
 * saying plainly rather than a request that fails upstream with a less
 * obvious message.
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

/**
 * The OpenAI error envelope, which both gateways use:
 * `{ error: { message, type, param, code } }`. A body that isn't that shape
 * (an HTML error page from a proxy, say) still yields its text, truncated.
 */
function parseErrorBody(raw: string): { message: string | null; code: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { message: null, code: null };
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: unknown; code?: unknown } | null };
    const message = typeof parsed.error?.message === "string" ? parsed.error.message : null;
    const code = typeof parsed.error?.code === "string" ? parsed.error.code : null;
    return message ? { message, code } : { message: trimmed.slice(0, 300), code };
  } catch {
    return { message: trimmed.slice(0, 300), code: null };
  }
}

/** What the request asked to run on, for an error that is about the model. */
function modelFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as { model?: unknown; models?: unknown };
  if (typeof record.model === "string") return record.model;
  if (Array.isArray(record.models)) return record.models.filter((m) => typeof m === "string").join(", ") || null;
  return null;
}

/**
 * Turns a gateway's status code into a sentence that says what to do about it.
 *
 * The statuses are not interchangeable and reporting them as one thing costs
 * real debugging time: 401 is the key, 402 is the balance, 403 is a *provider*
 * that isn't available right now (Ramp Router documents it exactly that way —
 * it is not an auth failure), 404 is a model this key can't call, 429 is rate
 * limiting, 501 is a capability the chosen model doesn't have and won't grow by
 * being retried, and 5xx is the gateway or the provider rather than anything
 * about this request.
 */
function describeFailure(
  credentials: AiCredentials,
  status: number,
  raw: string,
  retryAfter: string | null,
  requestBody: unknown,
): string {
  const label = AI_PROVIDER_LABELS[credentials.provider];
  const { message, code } = parseErrorBody(raw);
  const detail = message ? ` ${message}` : "";

  switch (status) {
    case 400:
      return `${label} rejected the request as invalid (400).${detail}`;
    case 401:
      // Router distinguishes a key it doesn't know from one that has been
      // switched off — the second is recoverable by re-enabling it, so it is
      // worth not calling both "invalid".
      return code === "api_key_deactivated"
        ? `${label} reports this API key as deactivated — re-enable it or connect another.${detail}`
        : `${label} rejected the API key (${status}).${detail}`;
    case 402:
      return `${label} rejected the request: insufficient credits.${detail}`;
    case 403:
      return credentials.provider === "router"
        ? `${label} could not use the selected provider right now (403) — this is the provider, not the key.${detail}`
        : `${label} refused the request (403).${detail}`;
    case 404: {
      const model = modelFromBody(requestBody);
      return (
        `${label} has no model ${model ? `"${model}" ` : ""}available to this key (404) — ` +
        `pick one from the model list in Settings → Integrations.${detail}`
      );
    }
    case 429:
      return `${label} rate-limited the request (429)${retryAfter ? `; retry after ${retryAfter}s` : ""}.${detail}`;
    case 501:
      return (
        `${label} could not run this request on the selected model (501) — ` +
        `it doesn't support something the request used, so retrying it unchanged will fail the same way.${detail}`
      );
    case 502:
    case 503:
    case 504:
      return `${label} could not get an answer from the model provider (${status}) — worth retrying.${detail}`;
    default:
      return `${label} request failed (${status}).${detail}`;
  }
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
    const raw = await response.text().catch(() => "");
    const retryAfter = response.headers?.get?.("retry-after") ?? null;
    throw new AiTransportError(describeFailure(credentials, response.status, raw, retryAfter, body));
  }

  return response.json();
}

/* ------------------------------------------------------------------ *
 * OpenAI chat completions — OpenRouter, Google Gemini
 * ------------------------------------------------------------------ */

interface ChatCompletionsChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string;
}

/**
 * Which route selector this provider's chat-completions endpoint accepts.
 *
 * `models` — an ordered fallback chain tried in turn — is an OpenRouter
 * extension here. Router has its own version of the idea on the responses
 * side (see `routerRouteSelector`), but Gemini's compatibility layer takes
 * a single `model` string and 400s on the array. So a comma-separated
 * connection model stays a real chain on OpenRouter and collapses to its
 * first entry on Gemini, which is the honest reading of a preference list
 * a provider cannot honour.
 */
function chatCompletionsRouteSelector(
  credentials: AiCredentials,
  resolved: { model: string } | { models: string[] },
): Record<string, unknown> {
  if ("model" in resolved) return { model: resolved.model };
  if (credentials.provider === "openrouter") return { models: resolved.models };
  return { model: resolved.models[0]! };
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
 * Gemini shares this request path but none of those extensions: it routes
 * to nothing (the model id names the generation outright, so there is no
 * auto-select to constrain) and it reports no per-request cost, which is
 * why an agent running on Gemini shows tokens and a zero spend — the same
 * gap Ramp Router has, documented on `ChatUsage.costUsd`.
 */
async function callChatCompletions(credentials: AiCredentials, request: ModelRequest): Promise<ChatResult> {
  const isOpenRouter = credentials.provider === "openrouter";

  const body: Record<string, unknown> = {
    ...chatCompletionsRouteSelector(credentials, resolveModel(requireModel(credentials, request.model))),
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

/** Router's documented ceiling for a `models` fallback list. */
const ROUTER_MAX_CANDIDATES = 15;

/**
 * Which of Router's two route selectors to send. Exactly one of `model` or
 * `models` is allowed — sending both, or neither, is a 400.
 *
 * `models` is a real fallback chain (tried in order, first success wins), so a
 * connection configured with several models gets the same resilience on Router
 * as on OpenRouter. The catch is that its entries have to be *concrete*
 * `provider:provider-model[:service-tier]` candidates, while `model` takes a
 * catalogue id from `GET /v1/models`, which need not carry a provider prefix.
 * A list whose entries are not all provider-qualified therefore cannot legally
 * be a `models` array, and pinning the first entry — what this client did with
 * every list — stays the honest reading of it.
 *
 * Over-long lists are truncated rather than sent and rejected: the entries are
 * in preference order, so the first fifteen are the ones that matter.
 */
function routerRouteSelector(resolved: { model: string } | { models: string[] }): Record<string, unknown> {
  if ("model" in resolved) return { model: resolved.model };
  const candidates = resolved.models;
  if (!candidates.every((candidate) => candidate.includes(":"))) return { model: candidates[0]! };
  return { models: candidates.slice(0, ROUTER_MAX_CANDIDATES) };
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
 * A fallback chain *does* carry over, unlike what this comment used to claim:
 * Router takes a `models` array as an alternative route selector — see
 * `routerRouteSelector`.
 */
async function callResponses(credentials: AiCredentials, request: ModelRequest): Promise<ChatResult> {
  const resolved = resolveModel(requireModel(credentials, request.model));

  const body: Record<string, unknown> = {
    ...routerRouteSelector(resolved),
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
