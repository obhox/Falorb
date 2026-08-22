import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER_BASE_URLS, type AiCredentials } from "./credentials";
import { AiTtsError, synthesizeSpeech } from "./tts";

const GEMINI: AiCredentials = {
  provider: "gemini",
  baseUrl: AI_PROVIDER_BASE_URLS.gemini,
  apiKey: "AIza-test",
  model: "gemini-2.5-flash",
};

const OPENROUTER: AiCredentials = {
  provider: "openrouter",
  baseUrl: AI_PROVIDER_BASE_URLS.openrouter,
  apiKey: "sk-or-test",
  model: null,
};

function mockFetch(body: unknown, init: { status?: number; text?: string } = {}) {
  const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    init.status && init.status >= 400
      ? ({ ok: false, status: init.status, text: async () => init.text ?? "" } as unknown as Response)
      : ({ ok: true, status: 200, json: async () => body } as unknown as Response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const PCM_SAMPLE = Buffer.from([0x01, 0x02, 0x03, 0x04]).toString("base64");

function geminiAudioResponse(mimeType = "audio/L16;rate=24000") {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { data: PCM_SAMPLE, mimeType } }],
        },
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("synthesizeSpeech", () => {
  it("refuses a non-Gemini connection without calling out", async () => {
    const spy = mockFetch({});
    await expect(synthesizeSpeech("hello", { credentials: OPENROUTER })).rejects.toThrow(AiTtsError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls Gemini's native generateContent with the API key as a header, not a bearer token", async () => {
    const spy = mockFetch(geminiAudioResponse());
    await synthesizeSpeech("hello", { credentials: GEMINI });

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
    );
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("AIza-test");
    expect(headers.Authorization).toBeUndefined();

    const body = JSON.parse(init?.body as string);
    expect(body.contents[0].parts[0].text).toBe("hello");
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
  });

  it("wraps Gemini's raw PCM in a playable WAV container", async () => {
    mockFetch(geminiAudioResponse("audio/L16;rate=24000"));
    const result = await synthesizeSpeech("hello", { credentials: GEMINI });

    expect(result.mimeType).toBe("audio/wav");
    const wav = Buffer.from(result.audioBase64, "base64");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt32LE(24)).toBe(24_000); // sample rate field
    // Header (44 bytes) plus the original PCM payload, untouched.
    expect(wav.subarray(44).toString("base64")).toBe(PCM_SAMPLE);
  });

  it("falls back to 24kHz when Gemini's mimeType carries no rate", async () => {
    mockFetch(geminiAudioResponse("audio/L16"));
    const result = await synthesizeSpeech("hello", { credentials: GEMINI });
    const wav = Buffer.from(result.audioBase64, "base64");
    expect(wav.readUInt32LE(24)).toBe(24_000);
  });

  it("throws AiTtsError on a non-2xx response", async () => {
    mockFetch(null, { status: 429, text: "rate limited" });
    await expect(synthesizeSpeech("hello", { credentials: GEMINI })).rejects.toThrow(/HTTP 429/);
  });

  it("throws AiTtsError when the response has no audio part", async () => {
    mockFetch({ candidates: [{ content: { parts: [{ text: "no audio here" }] } }] });
    await expect(synthesizeSpeech("hello", { credentials: GEMINI })).rejects.toThrow(/no audio/i);
  });
});
