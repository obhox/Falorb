import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER_BASE_URLS, type AiCredentials } from "./credentials";
import { AiTransportError, callModel } from "./transport";
import type { ChatMessage } from "./types";

/**
 * The three providers' protocols, pinned.
 *
 * `transport.ts` is the only place that knows OpenRouter and Gemini speak
 * chat completions while Ramp Router speaks responses, and the Ramp Router
 * and Gemini halves were both written against published docs rather than a
 * live key (see FEATURES.md §13c). These tests are what stops a refactor
 * from quietly reshaping any of the three requests — the failure mode there
 * is not a type error, it is a 400 from a vendor nobody runs in CI.
 *
 * Gemini shares OpenRouter's request path, which is exactly why it needs
 * its own cases: everything OpenRouter-specific on that path
 * (`usage.include`, `provider.require_parameters`, the `models` fallback
 * array) is a 400 or a silently-ignored field on Google's compatibility
 * layer, and nothing but a test distinguishes "shared path" from "sends
 * OpenRouter's extensions to Google".
 */

const OPENROUTER: AiCredentials = {
  provider: "openrouter",
  baseUrl: AI_PROVIDER_BASE_URLS.openrouter,
  apiKey: "sk-or-test",
  model: null,
};

const ROUTER: AiCredentials = {
  provider: "router",
  baseUrl: AI_PROVIDER_BASE_URLS.router,
  apiKey: "rr-test",
  model: "gpt-5",
};

const GEMINI: AiCredentials = {
  provider: "gemini",
  baseUrl: AI_PROVIDER_BASE_URLS.gemini,
  apiKey: "AIza-test",
  model: "gemini-2.5-flash",
};

function mockFetch(body: unknown, init: { status?: number; text?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers ?? {});
  const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    init.status && init.status >= 400
      ? ({ ok: false, status: init.status, headers, text: async () => init.text ?? "" } as unknown as Response)
      : ({ ok: true, status: 200, headers, json: async () => body } as unknown as Response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The OpenAI error envelope both gateways answer failures with. */
const errorBody = (message: string, code?: string) =>
  JSON.stringify({ error: { message, type: "invalid_request_error", param: null, ...(code ? { code } : {}) } });

interface SentRequest {
  url: string;
  body: Record<string, any>;
  headers: Record<string, string>;
}

function lastRequest(spy: ReturnType<typeof mockFetch>): SentRequest {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error("fetch was never called");
  const [url, init] = call;
  return {
    url: String(url),
    body: JSON.parse(String(init?.body)),
    headers: (init?.headers ?? {}) as Record<string, string>,
  };
}

/** The error a call rejected with, typed — `.catch(e => e)` widens to the result union. */
async function failure(call: Promise<unknown>): Promise<Error> {
  const outcome = await call.then(() => null, (error: unknown) => error);
  if (!(outcome instanceof Error)) throw new Error("expected the call to fail, but it resolved");
  return outcome;
}

const CONVERSATION: ChatMessage[] = [
  { role: "system", content: "be brief" },
  { role: "user", content: "who is hot?" },
  { role: "assistant", content: "checking", toolCalls: [{ id: "call_1", name: "get_leads", argumentsJson: '{"limit":5}' }] },
  { role: "tool", toolCallId: "call_1", name: "get_leads", content: "[]" },
];

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter (chat completions)", () => {
  it("posts to /chat/completions with messages, tool_calls and the OpenRouter-only extensions", async () => {
    const spy = mockFetch({
      choices: [{ message: { content: "nobody" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 3, cost: 0.0004 },
    });

    const result = await callModel(OPENROUTER, {
      messages: CONVERSATION,
      tools: [{ name: "get_leads", description: "leads", parameters: { type: "object" } }],
      maxTokens: 500,
      timeoutMs: 1000,
    });

    const { url, body } = lastRequest(spy);
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    // Unset model means auto — the platform's deliberate non-pinning default.
    expect(body.model).toBe("openrouter/auto");
    expect(body.max_tokens).toBe(500);
    expect(body.usage).toEqual({ include: true });
    // Without this, `openrouter/auto` may route a tool-carrying request to a
    // model that ignores tools, which reads as a bad agent rather than a
    // misrouted request.
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "get_leads", description: "leads", parameters: { type: "object" } },
    });
    expect(body.messages[2]).toEqual({
      role: "assistant",
      content: "checking",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_leads", arguments: '{"limit":5}' } }],
    });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", name: "get_leads", content: "[]" });

    expect(result).toEqual({
      content: "nobody",
      toolCalls: [],
      usage: { promptTokens: 11, completionTokens: 3, costUsd: 0.0004 },
      finishReason: "stop",
    });
  });

  it("sends a comma-separated model as OpenRouter's fallback chain", async () => {
    const spy = mockFetch({ choices: [{ message: { content: "hi" } }] });
    await callModel({ ...OPENROUTER, model: "a/one, b/two" }, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 });
    const { body } = lastRequest(spy);
    expect(body.models).toEqual(["a/one", "b/two"]);
    expect(body.model).toBeUndefined();
  });

  it("reads tool calls back out", async () => {
    mockFetch({
      choices: [
        {
          message: { content: null, tool_calls: [{ id: "c9", function: { name: "mark", arguments: '{"id":1}' } }] },
          finish_reason: "tool_calls",
        },
      ],
    });
    const result = await callModel(OPENROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 });
    expect(result.toolCalls).toEqual([{ id: "c9", name: "mark", argumentsJson: '{"id":1}' }]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("treats a 200 carrying an error body as a failure", async () => {
    mockFetch({ error: { message: "upstream exploded" } });
    await expect(
      callModel(OPENROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/upstream exploded/);
  });
});

describe("Gemini thought signatures", () => {
  it("keeps the signature a function call came with and echoes it on the next request", async () => {
    const spy = mockFetch({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                function: { name: "list_tasks", arguments: "{}" },
                extra_content: { google: { thought_signature: "sig-abc" } },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const first = await callModel(GEMINI, { messages: CONVERSATION.slice(0, 2), maxTokens: 10, timeoutMs: 100 });
    expect(first.toolCalls).toEqual([{ id: "c1", name: "list_tasks", argumentsJson: "{}", thoughtSignature: "sig-abc" }]);

    await callModel(GEMINI, {
      messages: [
        ...CONVERSATION.slice(0, 2),
        { role: "assistant", content: null, toolCalls: first.toolCalls },
        { role: "tool", toolCallId: "c1", name: "list_tasks", content: "[]" },
      ],
      maxTokens: 10,
      timeoutMs: 100,
    });
    const sent = lastRequest(spy).body.messages[2].tool_calls[0];
    expect(sent.extra_content).toEqual({ google: { thought_signature: "sig-abc" } });
  });

  it("sends Google's documented placeholder for a call persisted without a signature", async () => {
    const spy = mockFetch({ choices: [{ message: { content: "ok" } }] });
    await callModel(GEMINI, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 });
    const sent = lastRequest(spy).body.messages[2].tool_calls[0];
    expect(sent.extra_content).toEqual({ google: { thought_signature: "skip_thought_signature_validator" } });
  });

  it("never sends extra_content to OpenRouter, which forwards unknown fields upstream", async () => {
    const spy = mockFetch({ choices: [{ message: { content: "ok" } }] });
    await callModel(OPENROUTER, {
      messages: [
        ...CONVERSATION.slice(0, 2),
        { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "x", argumentsJson: "{}", thoughtSignature: "sig" }] },
        { role: "tool", toolCallId: "c1", name: "x", content: "[]" },
      ],
      maxTokens: 10,
      timeoutMs: 100,
    });
    expect(lastRequest(spy).body.messages[2].tool_calls[0]).not.toHaveProperty("extra_content");
  });
});

describe("Ramp Router (responses)", () => {
  it("posts to /responses with input items rather than messages", async () => {
    const spy = mockFetch({
      output: [{ type: "message", content: [{ type: "output_text", text: "nobody" }] }],
      status: "completed",
      usage: { input_tokens: 9, output_tokens: 2 },
    });

    const result = await callModel(ROUTER, {
      messages: CONVERSATION,
      tools: [{ name: "get_leads", description: "leads", parameters: { type: "object" } }],
      maxTokens: 500,
      timeoutMs: 1000,
    });

    const { url, body, headers } = lastRequest(spy);
    expect(url).toBe("https://api.router.com/v1/responses");
    expect(headers.Authorization).toBe("Bearer rr-test");
    expect(body.model).toBe("gpt-5");
    expect(body.max_output_tokens).toBe(500);
    expect(body.max_tokens).toBeUndefined();
    // Tools are declared flat here, not nested under `function`.
    expect(body.tools[0]).toEqual({
      type: "function",
      name: "get_leads",
      description: "leads",
      parameters: { type: "object" },
    });
    // An assistant turn that both spoke and called a tool becomes two items,
    // and the tool result is an item of its own rather than a message.
    expect(body.input).toEqual([
      { role: "system", content: [{ type: "input_text", text: "be brief" }] },
      { role: "user", content: [{ type: "input_text", text: "who is hot?" }] },
      { role: "assistant", content: [{ type: "output_text", text: "checking" }] },
      { type: "function_call", call_id: "call_1", name: "get_leads", arguments: '{"limit":5}' },
      { type: "function_call_output", call_id: "call_1", output: "[]" },
    ]);

    // Ramp Router reports no cost; a zero here is honest, not a bug.
    expect(result).toEqual({
      content: "nobody",
      toolCalls: [],
      usage: { promptTokens: 9, completionTokens: 2, costUsd: 0 },
      finishReason: "stop",
    });
  });

  it("collects text and function calls out of one mixed output array", async () => {
    mockFetch({
      output: [
        { type: "message", content: [{ type: "output_text", text: "on it" }] },
        { type: "function_call", call_id: "fc_1", name: "mark", arguments: '{"id":2}' },
      ],
      status: "completed",
    });
    const result = await callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 });
    expect(result.content).toBe("on it");
    expect(result.toolCalls).toEqual([{ id: "fc_1", name: "mark", argumentsJson: '{"id":2}' }]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("reports a truncated answer as length, the same word chat completions uses", async () => {
    mockFetch({
      output: [{ type: "message", content: [{ type: "output_text", text: "half a th" }] }],
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
    const result = await callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 });
    expect(result.finishReason).toBe("length");
  });

  it("sends a provider-qualified list as Router's own fallback chain", async () => {
    // Router takes `models` as an alternative route selector, tried in order —
    // this client used to drop everything after the first entry, so a
    // connection configured with fallbacks quietly had none.
    const spy = mockFetch({ output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }] });
    await callModel(
      { ...ROUTER, model: "openai:gpt-5.4-mini, fireworks:accounts/fireworks/models/kimi:flex" },
      { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 },
    );
    const { body } = lastRequest(spy);
    expect(body.models).toEqual(["openai:gpt-5.4-mini", "fireworks:accounts/fireworks/models/kimi:flex"]);
    // Exactly one selector: sending both is a 400.
    expect(body.model).toBeUndefined();
  });

  it("pins the first entry when the list isn't provider-qualified, since `models` only takes candidates", async () => {
    const spy = mockFetch({ output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }] });
    await callModel({ ...ROUTER, model: "gpt-5, opus-5" }, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 });
    const { body } = lastRequest(spy);
    expect(body.model).toBe("gpt-5");
    expect(body.models).toBeUndefined();
  });

  it("truncates a fallback list to the 15 candidates Router accepts", async () => {
    const spy = mockFetch({ output: [{ type: "message", content: [{ type: "output_text", text: "x" }] }] });
    const many = Array.from({ length: 20 }, (_, i) => `openai:model-${i}`);
    await callModel(
      { ...ROUTER, model: many.join(", ") },
      { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 },
    );
    // In preference order, so the first fifteen are the ones worth keeping —
    // sending all twenty would be rejected outright.
    expect(lastRequest(spy).body.models).toEqual(many.slice(0, 15));
  });

  it("refuses to call at all when no model is set, since it has no auto model", async () => {
    const spy = mockFetch({});
    await expect(
      callModel({ ...ROUTER, model: null }, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/No model is set for the Ramp Router connection/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("names the rejected key rather than the status alone", async () => {
    mockFetch(null, { status: 401 });
    await expect(
      callModel(OPENROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow("OpenRouter rejected the API key (401).");
  });

  it("distinguishes a deactivated key from an unknown one, which is fixed differently", async () => {
    mockFetch(null, { status: 401, text: errorBody("Key is disabled.", "api_key_deactivated") });
    await expect(
      callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/deactivated/);
  });

  it("calls out insufficient credits, which is not a bug to debug", async () => {
    mockFetch(null, { status: 402 });
    await expect(
      callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow("Ramp Router rejected the request: insufficient credits.");
  });

  it("does not report a 403 as a bad key — on Router it is the provider, not the credential", async () => {
    mockFetch(null, { status: 403, text: errorBody("Provider unavailable.") });
    const error = await failure(callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }));
    expect(error.message).toMatch(/provider/i);
    expect(error.message).not.toMatch(/rejected the API key/);
  });

  it("names the model a 404 was asked for, since that is the thing to change", async () => {
    mockFetch(null, { status: 404, text: errorBody("Model not found.") });
    await expect(
      callModel({ ...ROUTER, model: "openai:gpt-nope" }, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/openai:gpt-nope/);
  });

  it("passes on how long a rate limit says to wait", async () => {
    mockFetch(null, { status: 429, text: errorBody("Slow down."), headers: { "retry-after": "30" } });
    await expect(
      callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/retry after 30s/);
  });

  it("says a 501 will not come good on a retry", async () => {
    mockFetch(null, { status: 501, text: errorBody("Tools are not supported for this model.") });
    await expect(
      callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/retrying it unchanged will fail the same way/);
  });

  it("marks a provider-side 5xx as worth retrying", async () => {
    mockFetch(null, { status: 502, text: errorBody("openai provider request failed.") });
    await expect(
      callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/worth retrying/);
  });

  it("surfaces the gateway's own message rather than the raw error envelope", async () => {
    mockFetch(null, { status: 400, text: errorBody("`allow_flex_tier` is only supported for eligible models.") });
    const error = await failure(callModel(ROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }));
    expect(error.message).toContain("`allow_flex_tier` is only supported for eligible models.");
    expect(error.message).not.toContain('{"error"');
  });

  it("wraps a network failure as a transport error naming the gateway", async () => {
    vi.stubGlobal("fetch", vi.fn(async (): Promise<Response> => { throw new Error("ECONNREFUSED"); }));
    await expect(
      callModel(OPENROUTER, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(AiTransportError);
  });
});

describe("Google Gemini (chat completions, via the OpenAI-compatibility layer)", () => {
  it("posts to the /openai path with none of OpenRouter's extensions", async () => {
    const spy = mockFetch({
      choices: [{ message: { content: "nobody" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 3 },
    });

    const result = await callModel(GEMINI, {
      messages: CONVERSATION,
      tools: [{ name: "get_leads", description: "leads", parameters: { type: "object" } }],
      maxTokens: 500,
      timeoutMs: 1000,
    });

    const { url, body, headers } = lastRequest(spy);
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    // Bearer auth, not the `?key=` query parameter Google's native API also
    // takes — a key in a URL ends up in every access log along the way.
    expect(headers.Authorization).toBe("Bearer AIza-test");
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.max_tokens).toBe(500);
    // Both of these are OpenRouter extensions. `usage.include` means nothing
    // to Google, and `provider.require_parameters` names a routing concept
    // that does not exist when the model id is the whole routing decision.
    expect(body.usage).toBeUndefined();
    expect(body.provider).toBeUndefined();
    // Tools still go in OpenAI's nested `function` shape, which the
    // compatibility layer accepts — that is the point of using it.
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "get_leads", description: "leads", parameters: { type: "object" } },
    });

    // No cost reported, like Ramp Router — see `ChatUsage.costUsd`.
    expect(result.usage).toEqual({ promptTokens: 11, completionTokens: 3, costUsd: 0 });
    expect(result.content).toBe("nobody");
  });

  it("collapses a fallback chain to its first entry, which is all it can honour", async () => {
    const spy = mockFetch({ choices: [{ message: { content: "hi" } }] });
    await callModel(
      { ...GEMINI, model: "gemini-2.5-pro, gemini-2.5-flash" },
      { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 },
    );
    const { body } = lastRequest(spy);
    // A `models` array is an OpenRouter/Router route selector; here it is a 400.
    expect(body.model).toBe("gemini-2.5-pro");
    expect(body.models).toBeUndefined();
  });

  it("refuses to call at all when no model is set, since it has no auto model", async () => {
    const spy = mockFetch({});
    await expect(
      callModel({ ...GEMINI, model: null }, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 }),
    ).rejects.toThrow(/No model is set for the Google Gemini connection/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads tool calls back out of the shared chat-completions shape", async () => {
    mockFetch({
      choices: [
        {
          message: { content: null, tool_calls: [{ id: "c9", function: { name: "mark", arguments: '{"id":1}' } }] },
          finish_reason: "tool_calls",
        },
      ],
    });
    const result = await callModel(GEMINI, { messages: CONVERSATION, maxTokens: 10, timeoutMs: 100 });
    expect(result.toolCalls).toEqual([{ id: "c9", name: "mark", argumentsJson: '{"id":1}' }]);
    expect(result.finishReason).toBe("tool_calls");
  });
});
