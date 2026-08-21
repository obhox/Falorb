import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, projects } from "./tenancy";
import { user } from "./auth";

/**
 * AI-generated UGC-style video for social posting (FEATURES.md §18).
 * Built in-house rather than integrating a single UGC vendor (Arcads,
 * HeyGen, ...) — a chain of three ElevenLabs calls owned end to end by
 * Falorb: a script (`@falorb/ai`'s `complete()`), a voiceover
 * (`ElevenLabsClient.textToSpeech`), then a lip-synced talking video from a
 * user-supplied presenter photo (`ElevenLabsClient.createLipsyncVideo`).
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
 *   pending          just created, script not yet generated
 *   script_ready     script written, voiceover not yet requested
 *   voice_ready      voiceover generated, video not yet submitted
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

    /** What the user typed: the product/offer/angle the video should sell. */
    brief: text("brief").notNull(),
    script: text("script"),

    voiceId: text("voice_id").notNull(),
    audioBase64: text("audio_base64"),
    audioMimeType: text("audio_mime_type"),

    presenterImageBase64: text("presenter_image_base64").notNull(),
    presenterImageMimeType: text("presenter_image_mime_type").notNull(),

    /** The ElevenLabs Flows model used — see `LIPSYNC_MODEL_ID` in
     * `@falorb/elevenlabs-client`. Stored per-row, not just read from the
     * client's constant, so a future model change doesn't retroactively
     * mislabel videos generated under the old one. */
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
