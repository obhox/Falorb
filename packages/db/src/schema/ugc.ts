import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, projects } from "./tenancy";
import { user } from "./auth";

/**
 * AI-generated UGC-style video for social posting (FEATURES.md §18).
 * Built in-house rather than integrating a single UGC vendor (Arcads,
 * HeyGen, ...) — a chain of ElevenLabs calls owned end to end by Falorb, in
 * one of two shapes depending on `mode`:
 *
 *   "avatar"         a script (`@falorb/ai`'s `complete()`), a voiceover
 *                     (`ElevenLabsClient.textToSpeech`), then a lip-synced
 *                     talking video from a user-supplied presenter photo
 *                     (`ElevenLabsClient.createLipsyncVideo`).
 *   "text_to_video"   a script, straight to a text-to-video generation
 *                     (`ElevenLabsClient.createTextToVideo`) with its own
 *                     generated narration — no face required. A UGC video
 *                     is not necessarily a talking head; most of ElevenLabs'
 *                     Flows models are plain text-to-video.
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
 * the lifecycle and the resume point — the path forks after `script_ready`
 * depending on `mode`:
 *
 *   pending          just created, script not yet generated
 *   script_ready     script written; next is `voice_ready` (avatar mode) or
 *                    straight to `video_processing` (text_to_video mode,
 *                    which has no separate voice stage — Veo generates its
 *                    own narration as part of the video)
 *   voice_ready      voiceover generated, video not yet submitted (avatar
 *                    mode only)
 *   video_processing submitted to ElevenLabs, awaiting completion
 *   ready            video generated, `videoUrl` set
 *   failed           any stage errored; see `lastError`
 *
 * Plain `text()`, not `pgEnum` — UI-driven vocabulary, same convention as
 * `prospects.status`.
 *
 * The presenter/reference photo and generated voiceover are stored as
 * base64 `text` rather than in dedicated object storage: Falorb has no blob
 * store today, and these are small (a single portrait image, a voiceover
 * clip a few tens of seconds long) — well within a Postgres `text`
 * column's TOAST-compressed capacity. The final video itself is NOT
 * re-hosted here; `videoUrl` is ElevenLabs' own output URL. That URL's
 * retention window on ElevenLabs' side is not confirmed — see the client's
 * module comment — so a video a user cares about keeping should be
 * downloaded promptly. Mirroring it into durable storage is a natural
 * follow-up once Falorb has an object store for any feature, not something
 * to invent solely for this one.
 */
export const ugcVideos = pgTable(
  "ugc_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),

    /** "avatar" | "text_to_video" — see the table docblock for the two
     * pipeline shapes this forks into after `script_ready`. */
    mode: text("mode").notNull().default("avatar"),

    /** What the user typed: the product/offer/angle the video should sell. */
    brief: text("brief").notNull(),
    script: text("script"),

    /** Avatar mode only. Null means "let the worker job pick one" — resolved
     * at generation time (the org's first available voice), not at insert
     * time, so it always reflects the connected account's current voices. */
    voiceId: text("voice_id"),
    audioBase64: text("audio_base64"),
    audioMimeType: text("audio_mime_type"),

    /** Required in avatar mode (the face to animate); optional in
     * text_to_video mode (an optional product/style reference image, not a
     * face). Null in text_to_video mode when no reference image was given. */
    presenterImageBase64: text("presenter_image_base64"),
    presenterImageMimeType: text("presenter_image_mime_type"),

    /** The ElevenLabs Flows model used — `LIPSYNC_MODEL_ID` for avatar mode,
     * `TEXT_TO_VIDEO_MODEL_ID` for text_to_video, both in
     * `@falorb/elevenlabs-client`. Stored per-row, not just derived from
     * `mode`, so a future model change doesn't retroactively mislabel videos
     * generated under the old one. */
    videoModel: text("video_model").notNull(),
    /** ElevenLabs' generation id, for polling `GET /v1/flows/video/{id}`. */
    elevenlabsGenerationId: text("elevenlabs_generation_id"),
    videoUrl: text("video_url"),
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
