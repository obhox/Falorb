/**
 * Typed client for the ElevenLabs endpoints the UGC video pipeline uses
 * (`apps/worker/src/jobs/ugc-video-gen.ts`, FEATURES.md §18): the voice
 * library, text-to-speech for a voiceover, and the Flows video API for the
 * on-camera half. One vendor for all three rather than a separate TTS
 * vendor and a separate avatar/video vendor, now that ElevenLabs ships them
 * under one API key.
 *
 * Flows exposes two *shapes* of video model, and Falorb offers both rather
 * than only the avatar one:
 *
 *   avatar  `creatify-aurora` takes an image + an audio clip and returns a
 *           lip-synced talking video — the presenter-photo UGC ad.
 *   prompt  Veo and Seedance take a text prompt (plus optional reference
 *           images) and generate the footage outright — no presenter, no
 *           voiceover stage, the model can score its own audio.
 *
 * The two take different request bodies and need different things from the
 * user, which is why `VIDEO_MODELS` below carries an `input` discriminant
 * and per-model capabilities: the composer renders from that catalog rather
 * than hard-coding one model's fields, so adding a model is a row here, not
 * a form rewrite.
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
 * Confidence in the contract, endpoint by endpoint, since it is uneven:
 * `POST /v1/text-to-speech/{voice_id}` and `GET /v2/voices` are long-stable
 * and confirmed against current docs, field names included. The Flows video
 * API is newer and its published reference and its cookbook disagree on
 * details — the reference documents `POST /v1/flows/video` with snake_case
 * fields, the cookbook shows `POST /v1/flows/video/create` with camelCase.
 * This client follows the reference (the endpoint the previous revision
 * already used) and `getVideoGeneration` deliberately accepts several
 * plausible output-field names rather than asserting one, `content_url`
 * from the cookbook among them. Verify against a real response before
 * pointing this at production traffic — the same caveat
 * `@falorb/clay-client` carries for its own unconfirmed contract.
 */

import { DEFAULT_AVATAR_MODEL_ID, type AspectRatio, type Resolution } from "./models";

/** The model catalog is re-exported so a server-side caller has one import.
 * A *client* component must import "@falorb/elevenlabs-client/models"
 * directly instead — see that module's own comment. */
export * from "./models";

/** ElevenLabs has one fixed API root, unlike Linki/Bund AI's self-hosted
 * deployments — used when no per-connection override is stored, same
 * convention as `CLAY_DEFAULT_BASE_URL`. */
export const ELEVENLABS_DEFAULT_BASE_URL = "https://api.elevenlabs.io";

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

/** One entry from the org's own voice library. `previewUrl` is ElevenLabs'
 * hosted sample — the composer plays it directly, so nothing is proxied
 * through Falorb and picking a voice costs no generation credits. */
export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  /** "premade" | "cloned" | "professional" | "generated" | ... — open text,
   * ElevenLabs' vocabulary, shown as-is. */
  category: string | null;
  /** Free-form tags ElevenLabs attaches (accent, age, gender, use case). */
  labels: Record<string, string>;
  previewUrl: string | null;
  description: string | null;
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

/** ElevenLabs caps a page at 100. Falorb asks for the maximum in one call:
 * a voice library is a picker, not a feed, and paging one would put a
 * "load more" in the middle of a form for no benefit at the sizes real
 * accounts have. */
const VOICE_PAGE_SIZE = 100;

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
   * The org's voice library, for the composer's voice picker.
   *
   * `/v2/voices` rather than the older `/v1/voices`: v1 returns every voice
   * unpaged with no search, which for an account with a large shared library
   * is a multi-megabyte response to populate one dropdown.
   */
  async listVoices(opts: { search?: string } = {}): Promise<ElevenLabsVoice[]> {
    const params = new URLSearchParams({ page_size: String(VOICE_PAGE_SIZE) });
    if (opts.search) params.set("search", opts.search);

    const body = await this.requestJson<{ voices?: unknown[] }>(
      "GET",
      `/v2/voices?${params.toString()}`,
    );

    return (body.voices ?? []).flatMap((raw) => {
      const voice = raw as Record<string, unknown>;
      const voiceId = typeof voice.voice_id === "string" ? voice.voice_id : null;
      if (!voiceId) return [];

      // ElevenLabs' labels are documented as string:string, but a stray
      // non-string value should drop that one tag rather than the voice.
      const labels: Record<string, string> = {};
      if (voice.labels && typeof voice.labels === "object") {
        for (const [key, value] of Object.entries(voice.labels as Record<string, unknown>)) {
          if (typeof value === "string" && value) labels[key] = value;
        }
      }

      return [
        {
          voiceId,
          name: typeof voice.name === "string" && voice.name ? voice.name : voiceId,
          category: typeof voice.category === "string" ? voice.category : null,
          labels,
          previewUrl: typeof voice.preview_url === "string" ? voice.preview_url : null,
          description: typeof voice.description === "string" ? voice.description : null,
        },
      ];
    });
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
   * Avatar half: a presenter image + the voiceover audio in, a lip-synced
   * talking video out. Async on ElevenLabs' side — this returns immediately
   * with a generation id; poll `getVideoGeneration` for the result.
   *
   * `modelId` is a parameter rather than the `creatify-aurora` constant so
   * the row's own stored model is what gets sent — a video generated under
   * one avatar model does not silently re-render under a different one if
   * the default here changes.
   */
  async createAvatarVideo(input: {
    modelId?: string;
    imageBase64: string;
    imageMimeType: string;
    audioBase64: string;
    audioMimeType: string;
    resolution?: Resolution;
  }): Promise<VideoGenerationSubmission> {
    const body = await this.requestJson<{ id: string; status: string }>("POST", "/v1/flows/video", {
      model_id: input.modelId ?? DEFAULT_AVATAR_MODEL_ID,
      image: { content_base64: input.imageBase64, mime_type: input.imageMimeType },
      audio: { content_base64: input.audioBase64, mime_type: input.audioMimeType },
      resolution: input.resolution ?? "720p",
    });
    return { id: body.id, status: body.status };
  }

  /** @deprecated Renamed to `createAvatarVideo` now that it is one of two
   * generation shapes rather than the only one. */
  async createLipsyncVideo(input: {
    imageBase64: string;
    imageMimeType: string;
    audioBase64: string;
    audioMimeType: string;
    resolution?: Resolution;
  }): Promise<VideoGenerationSubmission> {
    return this.createAvatarVideo(input);
  }

  /**
   * Text-to-video half: a written prompt in, generated footage out. No
   * presenter photo and no ElevenLabs voiceover — when `generateAudio` is
   * on, the model scores the clip itself.
   *
   * Optional fields are omitted rather than sent as null so each model
   * applies its own default for anything the composer did not offer (the
   * catalog deliberately exposes fewer combinations than the API accepts).
   */
  async createPromptVideo(input: {
    modelId: string;
    prompt: string;
    aspectRatio?: AspectRatio;
    resolution?: Resolution;
    durationSecs?: number;
    generateAudio?: boolean;
  }): Promise<VideoGenerationSubmission> {
    const payload: Record<string, unknown> = {
      model_id: input.modelId,
      prompt: input.prompt,
    };
    if (input.aspectRatio) payload.aspect_ratio = input.aspectRatio;
    if (input.resolution) payload.resolution = input.resolution;
    if (input.durationSecs) payload.duration_secs = input.durationSecs;
    if (input.generateAudio !== undefined) payload.generate_audio = input.generateAudio;

    const body = await this.requestJson<{ id: string; status: string }>(
      "POST",
      "/v1/flows/video",
      payload,
    );
    return { id: body.id, status: body.status };
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
      (typeof body.content_url === "string" && body.content_url) ||
      (typeof output.content_url === "string" && output.content_url) ||
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
