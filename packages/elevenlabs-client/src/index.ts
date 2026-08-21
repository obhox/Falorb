/**
 * Typed client for the ElevenLabs endpoints the UGC video pipeline chains
 * together (`apps/worker/src/jobs/ugc-video-gen.ts`, FEATURES.md §18). A UGC
 * video does not require a face — most of the Flows video API's models are
 * plain text-to-video — so this supports two distinct pipelines rather than
 * assuming every video is a talking avatar:
 *
 *   - **Avatar** (a presenter photo was supplied): text-to-speech for the
 *     voiceover, then `creatify-aurora` — a required character image +
 *     required audio in, a lip-synced talking video out.
 *   - **Text-to-video** (no photo): the script goes straight to
 *     `veo-3.1-fast-generate-001` as a prompt, with `generate_audio: true` —
 *     Veo generates its own spoken narration and sound, no separate TTS call
 *     or `audio` field exists for this model. The Fast variant is
 *     ElevenLabs' own stated recommendation for "fast-paced social media
 *     content creation" over the full Veo 3.1 (better suited to longer,
 *     higher-fidelity cinematic output) — confirmed against ElevenLabs'
 *     current docs, not guessed.
 *
 * Both pipelines go through the same vendor under one API key rather than a
 * separate TTS vendor and a separate video vendor, and both are exposed by
 * the same `POST /v1/flows/video` endpoint — only the request body's
 * `model_id` and shape differ, handled by `createLipsyncVideo` and
 * `createTextToVideo` respectively.
 *
 * Connected per-organization through `integrationConnections`
 * (`provider: "elevenlabs"`), the same shape as Linki/Bund AI/Clay — each
 * org brings its own ElevenLabs account (their own voices, their own
 * billing) rather than sharing one Falorb-wide key. Same reasoning
 * `@falorb/clay-client`'s docblock gives for Clay: `baseUrl` is still a
 * constructor argument for symmetry with the other clients and for
 * testability, but ElevenLabs has one fixed API root, so the connect form
 * has no Base URL field — `ELEVENLABS_DEFAULT_BASE_URL` is what the connect
 * action supplies.
 *
 * The TTS endpoint (`POST /v1/text-to-speech/{voice_id}`) and the voice
 * list (`GET /v2/voices`) are ElevenLabs' long-stable core API and are
 * confirmed against current docs. The Flows video API (`POST
 * /v1/flows/video`, `GET /v1/flows/video/{id}`) is new (2026) and still in
 * beta on ElevenLabs' side — the request schema for both `creatify-aurora`
 * and `veo-3.1-fast-generate-001` below is written against ElevenLabs'
 * published API reference (fetched twice, consistently, so treated as
 * reliable), but the *response* shape of a completed generation (exactly
 * which field carries the output URL) was not confirmed against a live
 * call. `getVideoGeneration` below deliberately checks several plausible
 * field names rather than asserting one; verify against a real response
 * before pointing this at production traffic, same caveat
 * `@falorb/clay-client` carries for its own unconfirmed contract.
 */

/** ElevenLabs has one fixed API root, unlike Linki/Bund AI's self-hosted
 * deployments — used when no per-connection override is stored, same
 * convention as `CLAY_DEFAULT_BASE_URL`. */
export const ELEVENLABS_DEFAULT_BASE_URL = "https://api.elevenlabs.io";

/** The Flows video model for the avatar/lipsync stage — a required
 * character image + required audio in, a lip-synced talking video out. Only
 * used when a presenter photo was supplied. */
export const LIPSYNC_MODEL_ID = "creatify-aurora";

/** The Flows video model for pure text-to-video (no presenter photo) —
 * prompt in, video with its own generated narration/audio out. Fast variant:
 * ElevenLabs' own guidance names it for social/UGC-paced content over the
 * slower full Veo 3.1, which suits longer cinematic output better. */
export const TEXT_TO_VIDEO_MODEL_ID = "veo-3.1-fast-generate-001";

export type LipsyncResolution = "480p" | "720p";
export type TextToVideoResolution = "720p" | "1080p" | "4K";

export class ElevenLabsApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`ElevenLabs API error (HTTP ${status}): ${JSON.stringify(body)}`);
  }
}

export interface ElevenLabsClientOptions {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface SpeechResult {
  audioBase64: string;
  mimeType: string;
}

export interface Voice {
  voiceId: string;
  name: string;
  /** "premade" | "cloned" | "generated" | "professional" | ... — whatever
   * ElevenLabs returns, passed through rather than narrowed to a union, so
   * an account with a category this client hasn't seen yet doesn't lose the
   * voice from the list. */
  category: string;
  previewUrl: string | null;
}

export interface VideoGenerationSubmission {
  id: string;
  status: string;
}

export type VideoGenerationStatus = "pending" | "processing" | "completed" | "failed";

export interface VideoGenerationResult {
  status: VideoGenerationStatus;
  /** Set once `status` is "completed". */
  videoUrl: string | null;
  durationSeconds: number | null;
  /** Set once `status` is "failed", when ElevenLabs supplied a reason. */
  error: string | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ElevenLabsClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: ElevenLabsClientOptions) {
    this.baseUrl = (opts.baseUrl ?? ELEVENLABS_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async fetchRaw(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "xi-api-key": this.apiKey, ...init.headers },
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestJson<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchRaw(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) throw new ElevenLabsApiError(response.status, responseBody);
    return responseBody as T;
  }

  /**
   * Voiceover for a script. Returns base64 audio (rather than a Buffer) so
   * the caller can persist it straight into a `text` column, the same
   * inline form the Flows video request needs for its `audio` field.
   */
  async textToSpeech(
    text: string,
    voiceId: string,
    opts: { modelId?: string } = {},
  ): Promise<SpeechResult> {
    const response = await this.fetchRaw(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: opts.modelId ?? "eleven_multilingual_v2",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new ElevenLabsApiError(response.status, errorBody);
    }

    const mimeType = response.headers.get("content-type") ?? "audio/mpeg";
    const bytes = Buffer.from(await response.arrayBuffer());
    return { audioBase64: bytes.toString("base64"), mimeType };
  }

  /**
   * Submits a presenter image + voiceover audio and starts a lip-synced
   * talking-video generation. Async on ElevenLabs' side — this returns
   * immediately with a generation id; poll `getVideoGeneration` for the
   * result.
   */
  async createLipsyncVideo(input: {
    imageBase64: string;
    imageMimeType: string;
    audioBase64: string;
    audioMimeType: string;
    resolution?: LipsyncResolution;
  }): Promise<VideoGenerationSubmission> {
    const body = await this.requestJson<{ id: string; status: string }>("POST", "/v1/flows/video", {
      model_id: LIPSYNC_MODEL_ID,
      image: { type: "inline_base64", content_base64: input.imageBase64, mime_type: input.imageMimeType },
      audio: { type: "inline_base64", content_base64: input.audioBase64, mime_type: input.audioMimeType },
      resolution: input.resolution ?? "720p",
    });
    return { id: body.id, status: body.status };
  }

  /**
   * Submits a pure text-to-video generation — no face, no audio input.
   * `generate_audio: true` (the model's own default) makes Veo generate its
   * own spoken narration and ambient sound from the prompt; there is no
   * `audio` field on this model to feed a separate voiceover into, unlike
   * `createLipsyncVideo`. `referenceImage` is optional and Veo-specific
   * (`role: "subject"` — e.g. a product photo the video should feature),
   * not a face to animate.
   */
  async createTextToVideo(input: {
    prompt: string;
    referenceImage?: { base64: string; mimeType: string };
    durationSecs?: 4 | 6 | 8;
    resolution?: TextToVideoResolution;
    aspectRatio?: "16:9" | "9:16";
  }): Promise<VideoGenerationSubmission> {
    const body = await this.requestJson<{ id: string; status: string }>("POST", "/v1/flows/video", {
      model_id: TEXT_TO_VIDEO_MODEL_ID,
      prompt: input.prompt,
      generate_audio: true,
      duration_secs: input.durationSecs ?? 8,
      resolution: input.resolution ?? "720p",
      aspect_ratio: input.aspectRatio ?? "9:16",
      ...(input.referenceImage
        ? {
            images: [
              {
                role: "subject",
                type: "inline_base64",
                content_base64: input.referenceImage.base64,
                mime_type: input.referenceImage.mimeType,
              },
            ],
          }
        : {}),
    });
    return { id: body.id, status: body.status };
  }

  /**
   * The org's available voices (premade + any cloned/generated ones),
   * newest/most relevant first as ElevenLabs orders them — for the
   * generation form's voice picker. `page_size: 100` rather than paging
   * fully through a huge voice library; a form dropdown with more than a
   * hundred entries has bigger problems than truncation.
   */
  async listVoices(): Promise<Voice[]> {
    const body = await this.requestJson<{
      voices: Array<{ voice_id: string; name: string; category?: string; preview_url?: string | null }>;
    }>("GET", "/v2/voices?page_size=100");
    return body.voices.map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category ?? "unknown",
      previewUrl: v.preview_url ?? null,
    }));
  }

  /**
   * The cheapest authenticated call that proves the key works without
   * spending generation credits — `GET /v1/user`, ElevenLabs' account-info
   * endpoint. Same "who am I" reasoning `ClayClient.verifyConnection`'s
   * comment gives for its own no-dedicated-health-endpoint case.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    const response = await this.fetchRaw("/v1/user", { method: "GET" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, detail: `ElevenLabs returned HTTP ${response.status}: ${JSON.stringify(body)}` };
    }
    return { ok: true, detail: "ElevenLabs reachable and key accepted." };
  }

  /** Poll one generation. See the module-level comment: the completed-output
   * field name is not confirmed, so several plausible shapes are checked. */
  async getVideoGeneration(id: string): Promise<VideoGenerationResult> {
    const body = await this.requestJson<Record<string, unknown>>(
      "GET",
      `/v1/flows/video/${encodeURIComponent(id)}`,
    );

    const rawStatus = String(body.status ?? "").toLowerCase();
    const status: VideoGenerationStatus =
      rawStatus === "completed" || rawStatus === "succeeded" || rawStatus === "ready"
        ? "completed"
        : rawStatus === "failed" || rawStatus === "error"
          ? "failed"
          : rawStatus === "generating" || rawStatus === "processing"
            ? "processing"
            : "pending";

    const output = (body.output ?? body.result ?? {}) as Record<string, unknown>;
    const videoUrl =
      (typeof output.url === "string" && output.url) ||
      (typeof output.video_url === "string" && output.video_url) ||
      (typeof body.video_url === "string" && body.video_url) ||
      (typeof body.url === "string" && body.url) ||
      null;
    const durationRaw = output.duration_secs ?? output.duration_seconds ?? body.duration_secs;
    const durationSeconds = typeof durationRaw === "number" ? durationRaw : null;
    const error =
      (typeof body.error === "string" && body.error) ||
      (typeof body.error_message === "string" && body.error_message) ||
      null;

    return { status, videoUrl, durationSeconds, error };
  }
}
