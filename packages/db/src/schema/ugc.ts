import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, projects } from "./tenancy";
import { user } from "./auth";

/**
 * AI-generated UGC-style video for social posting (FEATURES.md §18).
 * Built in-house rather than integrating a single UGC vendor (Arcads,
 * HeyGen, ...) — a chain of ElevenLabs calls owned end to end by Falorb.
 *
 * `mode` is the fork, and it decides which columns below are meaningful,
 * which stages the worker runs, and what the composer asks for:
 *
 *   avatar  A script (`@falorb/ai`'s `complete()`), a voiceover
 *           (`ElevenLabsClient.textToSpeech`), then a lip-synced talking
 *           video from a user-supplied presenter photo
 *           (`createAvatarVideo`). Needs `voiceId` and a presenter photo.
 *   prompt  A shot description written from the same brief, sent straight
 *           to a text-to-video model — Veo, Seedance
 *           (`createPromptVideo`). No presenter, no voiceover; the model
 *           generates its own audio when `generateAudio` is set.
 *
 * Both modes exist because they answer different asks. The avatar mode is
 * the testimonial ad — a person to camera, in a voice the org has cloned.
 * The prompt mode is the b-roll/product cut, where there is no presenter to
 * photograph. Which one a row is cannot be inferred from `videoModel`
 * alone once the catalog grows, so it is stored rather than derived.
 *
 * Org-wide rather than project-scoped, same reasoning as `prospects`: a
 * social video is marketing content for the business, not analysis of one
 * property's traffic. `projectId` is an optional tag for which
 * property/brand it's for, not an ownership scope.
 *
 * The chain runs across several worker ticks
 * (`apps/worker/src/jobs/ugc-video-gen.ts`), one stage advanced per tick, so
 * a crash mid-chain resumes from the last completed stage rather than
 * restarting a (billed) generation from scratch. `status` is therefore both
 * the lifecycle and the resume point:
 *
 *   pending          just created, nothing written yet
 *   script_ready     avatar: script written, voiceover not yet requested
 *   voice_ready      avatar: voiceover generated, video not yet submitted
 *   prompt_ready     prompt: shot description written, not yet submitted
 *   video_processing submitted to ElevenLabs, awaiting completion
 *   ready            video generated, `videoUrl` set
 *   failed           any stage errored; see `lastError`
 *
 * Plain `text()`, not `pgEnum` — UI-driven vocabulary, same convention as
 * `prospects.status`.
 *
 * The presenter photo and generated voiceover are stored as base64 `text`
 * rather than in dedicated object storage: Falorb has no blob store today,
 * and these are small (a single portrait image, a voiceover clip a few tens
 * of seconds long) — well within a Postgres `text` column's TOAST-compressed
 * capacity. The final video itself is NOT re-hosted here; `videoUrl` is
 * ElevenLabs' own output URL. That URL's retention window on ElevenLabs'
 * side is not confirmed — see the client's module comment — so a video a
 * user cares about keeping should be downloaded promptly. Mirroring it into
 * durable storage is a natural follow-up once Falorb has an object store for
 * any feature, not something to invent solely for this one.
 */
export const ugcVideos = pgTable(
  "ugc_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),

    /** "avatar" | "prompt" — see the table docblock. Defaulted so every row
     * written before text-to-video existed reads back as what it was. */
    mode: text("mode").notNull().default("avatar"),

    /** What the user typed: the product/offer/angle the video should sell.
     * The same field in both modes — one brief, two ways of filming it. */
    brief: text("brief").notNull(),
    /** Avatar mode: the words the presenter speaks aloud. */
    script: text("script"),
    /** Prompt mode: the shot description sent to the video model. Kept apart
     * from `script` because they are not interchangeable — one is dialogue,
     * the other is camera direction, and the review page labels them so. */
    videoPrompt: text("video_prompt"),

    /** Avatar mode only. `voiceName` is denormalised from the org's
     * ElevenLabs library at submit time so the review page can say which
     * voice was used without a live API call — and still can after the voice
     * is renamed or deleted upstream. */
    voiceId: text("voice_id"),
    voiceName: text("voice_name"),
    audioBase64: text("audio_base64"),
    audioMimeType: text("audio_mime_type"),

    /** Avatar mode only — the face the lipsync model animates. */
    presenterImageBase64: text("presenter_image_base64"),
    presenterImageMimeType: text("presenter_image_mime_type"),

    /** The ElevenLabs Flows model used — an id from `VIDEO_MODELS` in
     * `@falorb/elevenlabs-client`. Stored per-row, not just read from the
     * client's constant, so a future model change doesn't retroactively
     * mislabel videos generated under the old one. */
    videoModel: text("video_model").notNull(),
    /** What was *asked for*, within the chosen model's advertised caps. Null
     * where the model doesn't take that parameter (the avatar model frames
     * itself from the photo and runs as long as the voiceover). */
    aspectRatio: text("aspect_ratio"),
    resolution: text("resolution"),
    requestedDurationSecs: integer("requested_duration_secs"),
    /** Prompt mode: let the model score its own audio. Meaningless in avatar
     * mode, where the audio is the ElevenLabs voiceover. */
    generateAudio: boolean("generate_audio").notNull().default(true),
    /** ElevenLabs' generation id, for polling `GET /v1/flows/video/{id}`. */
    elevenlabsGenerationId: text("elevenlabs_generation_id"),
    videoUrl: text("video_url"),
    /** The finished clip's actual length, as ElevenLabs reported it — not
     * `requestedDurationSecs`, which is what was asked for. */
    durationSeconds: integer("duration_seconds"),

    status: text("status").notNull().default("pending"),
    lastError: text("last_error"),
    /** Set when a stage that calls out to ElevenLabs starts, cleared when it
     * finishes. Lets the worker job reclaim a row stuck here past a timeout
     * (a crashed worker mid-call) instead of leaving it stranded forever. */
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ugc_videos_org_idx").on(t.organizationId),
    index("ugc_videos_org_status_idx").on(t.organizationId, t.status),
    index("ugc_videos_project_idx").on(t.projectId),
    index("ugc_videos_org_mode_idx").on(t.organizationId, t.mode),
  ],
);

/**
 * A durable "post this" queue, curated by a human — deliberately not
 * automated posting. Falorb has no live social-posting integration yet
 * (Postiz is queued, FEATURES.md §13/§18); this table exists so a finished
 * video isn't lost track of while that lands, not so it can auto-fire
 * anywhere today. Nothing reads `status` back out of "queued" except a human
 * on the review page.
 */
export const ugcVideoPostQueue = pgTable(
  "ugc_video_post_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    videoId: uuid("video_id")
      .notNull()
      .references(() => ugcVideos.id, { onDelete: "cascade" }),

    /** "tiktok" | "instagram_reels" | "youtube_shorts" | "linkedin" | "x" |
     * "facebook" — open text, UI-driven vocabulary, same convention as
     * `ugcVideos.status`; another platform is a new value, not a migration. */
    platform: text("platform").notNull(),
    caption: text("caption"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),

    /** "queued" | "posted" | "canceled" — "posted" is set by a human marking
     * it done after posting manually elsewhere, not by anything in Falorb
     * actually posting on the org's behalf. */
    status: text("status").notNull().default("queued"),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ugc_video_post_queue_org_idx").on(t.organizationId),
    index("ugc_video_post_queue_video_idx").on(t.videoId),
  ],
);
