/**
 * The Flows video model catalog — which models Falorb offers, what shape of
 * input each takes, and what each can be asked for.
 *
 * Its own module, separate from the HTTP client in `index.ts`, because the
 * composer (`apps/web/src/app/(app)/ugc-videos/UgcComposer.tsx`) is a client
 * component and renders its whole form from this data. Importing it from the
 * package root would pull `ElevenLabsClient` — `fetch` calls, `Buffer`, and
 * the API-key plumbing — into the browser bundle to reach a handful of
 * constants. Nothing here talks to ElevenLabs or touches a credential, so
 * this half is safe to ship to a browser and the other half never is.
 *
 * Re-exported from `index.ts` as well, so server-side callers keep one
 * import.
 */

/**
 * What a model needs from the user, and therefore which half of the
 * composer it renders. Not cosmetic — the two take genuinely different
 * request bodies (`createAvatarVideo` vs `createPromptVideo`) and different
 * worker stages.
 */
export type VideoModelInput = "avatar" | "prompt";

export type AspectRatio = "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type Resolution = "480p" | "720p" | "1080p" | "4K";

/** Retained for the pre-catalog call sites (and the `video_model` value
 * every existing row was written with). Prefer `DEFAULT_AVATAR_MODEL_ID`. */
export const LIPSYNC_MODEL_ID = "creatify-aurora";

export interface VideoModelSpec {
  /** The `model_id` sent to Flows. */
  id: string;
  label: string;
  vendor: string;
  input: VideoModelInput;
  /** One line, shown under the model's name in the composer — what it is
   * good at, not a spec sheet. */
  blurb: string;
  resolutions: Resolution[];
  /** Empty for `creatify-aurora`, whose output follows the presenter photo's
   * own framing rather than a requested ratio. */
  aspectRatios: AspectRatio[];
  /** Selectable lengths in seconds. Empty when the model derives length from
   * its input instead (the avatar model runs as long as the voiceover). */
  durations: number[];
  /** Whether the model can score its own audio (`generate_audio`). False for
   * the avatar model, whose audio *is* the ElevenLabs voiceover. */
  supportsGeneratedAudio: boolean;
}

/**
 * The Flows video models Falorb offers, and what each one can be asked for.
 *
 * The model ids and the overall parameter vocabulary are from ElevenLabs'
 * published Flows reference. The per-model *caps* (which resolutions, which
 * ratios, which durations) are Falorb's reading of that matrix and exist to
 * keep the composer from offering a combination the API will reject — they
 * are UI guardrails, not an authority. A rejected combination still surfaces
 * as a normal generation failure with ElevenLabs' own message; widen a row
 * here when that turns out to be too strict rather than removing the
 * guardrail.
 */
export const VIDEO_MODELS: VideoModelSpec[] = [
  {
    id: "creatify-aurora",
    label: "Creatify Aurora",
    vendor: "Creatify",
    input: "avatar",
    blurb: "Animates a presenter photo to your voiceover. The classic talking-head UGC ad.",
    resolutions: ["480p", "720p"],
    aspectRatios: [],
    durations: [],
    supportsGeneratedAudio: false,
  },
  {
    id: "veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast",
    vendor: "Google",
    input: "prompt",
    blurb: "Quick, cheaper drafts. Good for trying several angles before committing.",
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [4, 6, 8],
    supportsGeneratedAudio: true,
  },
  {
    id: "veo-3.1-generate-001",
    label: "Veo 3.1",
    vendor: "Google",
    input: "prompt",
    blurb: "Highest fidelity of the Veo pair, with native audio. Slower and pricier.",
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [4, 6, 8],
    supportsGeneratedAudio: true,
  },
  {
    id: "bytedance-seedance-v2",
    label: "Seedance 2.0",
    vendor: "ByteDance",
    input: "prompt",
    blurb: "Strong motion and camera work; generates picture and audio together.",
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    durations: [4, 6, 8, 10, 12],
    supportsGeneratedAudio: true,
  },
  {
    id: "bytedance-seedance-v2.5",
    label: "Seedance 2.5",
    vendor: "ByteDance",
    input: "prompt",
    blurb: "Seedance at up to 4K, for a hero cut you intend to keep.",
    resolutions: ["720p", "1080p", "4K"],
    aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    durations: [4, 6, 8, 10, 12],
    supportsGeneratedAudio: true,
  },
  {
    id: "bytedance-seedance-v2-fast",
    label: "Seedance 2.0 Fast",
    vendor: "ByteDance",
    input: "prompt",
    blurb: "Draft-speed Seedance. Same framing controls, less detail.",
    resolutions: ["480p", "720p"],
    aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    durations: [4, 6, 8],
    supportsGeneratedAudio: true,
  },
  {
    id: "bytedance-seedance-v2-mini",
    label: "Seedance 2.0 Mini",
    vendor: "ByteDance",
    input: "prompt",
    blurb: "The cheapest way to see whether an idea is worth rendering properly.",
    resolutions: ["480p", "720p"],
    aspectRatios: ["16:9", "1:1", "9:16"],
    durations: [4, 6],
    supportsGeneratedAudio: true,
  },
];

export const DEFAULT_AVATAR_MODEL_ID = "creatify-aurora";
export const DEFAULT_PROMPT_MODEL_ID = "veo-3.1-fast-generate-001";

export function getVideoModel(id: string | null | undefined): VideoModelSpec | null {
  if (!id) return null;
  return VIDEO_MODELS.find((m) => m.id === id) ?? null;
}

export function videoModelsFor(input: VideoModelInput): VideoModelSpec[] {
  return VIDEO_MODELS.filter((m) => m.input === input);
}
