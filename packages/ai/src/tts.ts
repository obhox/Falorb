import { AI_PROVIDER_LABELS, type AiCredentials } from "./credentials";

/**
 * Text-to-speech, for the one caller that needs it: the UGC voiceover
 * fallback (`apps/worker/src/jobs/ugc-video-gen.ts`, FEATURES.md §18).
 * ElevenLabs (`@falorb/elevenlabs-client`) is and remains the primary
 * voiceover vendor — this exists only for the tick where that call fails
 * and the organization happens to have a Google Gemini connection
 * (`credentials.ts`), so a transient ElevenLabs outage doesn't strand a
 * script that's already been paid for.
 *
 * Deliberately not routed through `transport.ts`: that module's
 * `callChatCompletions` talks to Gemini's OpenAI-compatibility layer, which
 * serves chat completions only — no audio response modality. Speech needs
 * Gemini's native `generateContent`, a different shape entirely (see
 * `credentials.ts`'s own comment on why the compatibility layer was chosen
 * for chat in the first place). So this calls that endpoint directly with
 * the same Gemini API key rather than teaching the shared transport a
 * one-off protocol branch no other caller needs.
 */

export class AiTtsError extends Error {}

export interface SpeechResult {
  audioBase64: string;
  mimeType: string;
}

export interface SynthesizeSpeechOptions {
  /** Must be a Gemini connection — this is the only provider here with a
   * key usable against Gemini's native API, not the gateway's chat model. */
  credentials: AiCredentials;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Pinned rather than read from `credentials.model`: the org's configured
 * model is whatever they picked for chat completions and is not guaranteed
 * to be TTS-capable. Speech is a different capability, so it asks for
 * Google's speech model by name regardless of what the connection's chat
 * model field says. */
const GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

/** One of Gemini's prebuilt voices. The row's own ElevenLabs `voiceId`
 * cannot carry over — the two vendors don't share a voice namespace — so
 * every fallback speaks in the same voice rather than Falorb guessing at a
 * "closest match" that doesn't really exist. */
const GEMINI_TTS_VOICE = "Kore";

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
    };
  }>;
}

/**
 * Ask Gemini to speak `text` aloud. Throws `AiTtsError` for anything short
 * of a usable audio clip back — a non-Gemini connection, a network failure,
 * a non-2xx response, or a response with no audio part — so the caller can
 * fold it into the same "voiceover failed" handling ElevenLabs errors
 * already get, rather than needing a second failure shape.
 */
export async function synthesizeSpeech(text: string, opts: SynthesizeSpeechOptions): Promise<SpeechResult> {
  const { credentials } = opts;
  if (credentials.provider !== "gemini") {
    throw new AiTtsError(
      `Text-to-speech fallback needs a Google Gemini connection — the active AI connection is ` +
        `${AI_PROVIDER_LABELS[credentials.provider]}.`,
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": credentials.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE } } },
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw new AiTtsError(`Gemini TTS request failed: ${String(error)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new AiTtsError(`Gemini TTS returned HTTP ${response.status}: ${body}`);
  }

  const data = (await response.json()) as GeminiGenerateContentResponse;
  const inline = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new AiTtsError("Gemini TTS returned no audio.");

  // Gemini's inline audio is raw PCM (16-bit signed LE, mono), not a
  // playable file on its own — wrap it in a WAV header so it can go
  // anywhere ElevenLabs' own MP3 output already goes: `createAvatarVideo`,
  // and an `<audio>` tag if it's ever played back directly.
  const sampleRate = parsePcmSampleRate(inline.mimeType) ?? 24_000;
  return { audioBase64: wrapPcmAsWav(inline.data, sampleRate), mimeType: "audio/wav" };
}

function parsePcmSampleRate(mimeType: string | undefined): number | null {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? Number(match[1]) : null;
}

function wrapPcmAsWav(pcmBase64: string, sampleRate: number): string {
  const pcm = Buffer.from(pcmBase64, "base64");
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]).toString("base64");
}
