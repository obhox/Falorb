ALTER TABLE "ugc_videos" ALTER COLUMN "voice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ugc_videos" ALTER COLUMN "presenter_image_base64" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ugc_videos" ALTER COLUMN "presenter_image_mime_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "mode" text DEFAULT 'avatar' NOT NULL;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "video_prompt" text;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "voice_name" text;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "aspect_ratio" text;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "requested_duration_secs" integer;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "generate_audio" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "ugc_videos_org_mode_idx" ON "ugc_videos" USING btree ("organization_id","mode");