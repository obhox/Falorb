import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGatewayClient } from "./gateway-client";

/**
 * The connect dialog's "test connection" answer, pinned.
 *
 * What matters here is that a failure says the *right* thing: this check is
 * the only thing standing between a working gateway and someone re-entering a
 * credential that was never the problem.
 */

function mockFetch(body: unknown, status = 200) {
  const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    status >= 400
      ? ({ ok: false, status, text: async () => "" } as unknown as Response)
      : ({ ok: true, status, json: async () => body } as unknown as Response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const router = () => new AiGatewayClient({ provider: "router", apiKey: "sk-routgw-test" });
const openrouter = () => new AiGatewayClient({ provider: "openrouter", apiKey: "sk-or-test" });
const gemini = () => new AiGatewayClient({ provider: "gemini", apiKey: "AIza-test" });

afterEach(() => vi.unstubAllGlobals());

describe("verifyConnection", () => {
  it("reports a Ramp Router key by what it can call, since its catalogue is key-scoped", async () => {
    mockFetch({ data: [{ id: "openai:gpt-5.4-mini" }, { id: "openai:gpt-5.4" }] });
    expect(await router().verifyConnection()).toEqual({
      ok: true,
      detail: "Ramp Router key is valid — 2 models available.",
    });
  });

  it("checks OpenRouter against /key, whose model list would accept any string", async () => {
    const spy = mockFetch({ data: { label: "falorb" } });
    const result = await openrouter().verifyConnection();
    expect(String(spy.mock.calls[0]?.[0])).toContain("/key");
    expect(result.detail).toContain('"falorb"');
  });

  it("calls a 401 what it is", async () => {
    mockFetch(null, 401);
    expect(await router().verifyConnection()).toEqual({
      ok: false,
      detail: "Ramp Router rejected the API key.",
    });
  });

  it("does not call a 403 a bad key — the credential is recognised", async () => {
    mockFetch(null, 403);
    const result = await router().verifyConnection();
    expect(result.ok).toBe(false);
    expect(result.detail).not.toMatch(/rejected the API key/);
    expect(result.detail).toMatch(/403/);
  });

  it("reports any other status rather than guessing at it", async () => {
    mockFetch(null, 503);
    expect((await router().verifyConnection()).detail).toBe("Ramp Router returned HTTP 503.");
  });
});

describe("listModels", () => {
  it("keeps only callable ids and sorts by the label a reader sees", async () => {
    mockFetch({ data: [{ id: "z-model", name: "Zeta" }, { id: "" }, { name: "no id" }, { id: "a-model" }] });
    expect(await router().listModels()).toEqual([
      { id: "a-model", name: "a-model" },
      { id: "z-model", name: "Zeta" },
    ]);
  });
});

describe("Google Gemini", () => {
  it("is verified against its key-scoped model list, like Ramp Router", async () => {
    const spy = mockFetch({ data: [{ id: "models/gemini-2.5-flash" }] });

    const result = await gemini().verifyConnection();

    // Google's compatibility layer 401s a wrong key here rather than serving
    // a public catalogue, so unlike OpenRouter's this list is a real check.
    expect(String(spy.mock.calls[0]![0])).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/models",
    );
    expect(result).toEqual({ ok: true, detail: "Google Gemini key is valid — 1 model available." });
  });

  it("strips the `models/` resource prefix down to the callable id", async () => {
    mockFetch({ data: [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-2.5-pro" }] });

    // Whatever comes out of here is stored on the connection and sent as
    // `model` on every later call, so the bare form Google documents is the
    // one that should reach the database.
    expect(await gemini().listModels()).toEqual([
      { id: "gemini-2.5-flash", name: "gemini-2.5-flash" },
      { id: "gemini-2.5-pro", name: "gemini-2.5-pro" },
    ]);
  });

  it("leaves other providers' slash-bearing ids alone", async () => {
    mockFetch({ data: [{ id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" }] });

    // OpenRouter ids are `vendor/model` by design — nothing to strip.
    expect(await openrouter().listModels()).toEqual([
      { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    ]);
  });
});
