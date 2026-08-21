ALTER TABLE "ugc_videos" ALTER COLUMN "voice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ugc_videos" ALTER COLUMN "presenter_image_base64" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ugc_videos" ALTER COLUMN "presenter_image_mime_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD COLUMN "mode" text DEFAULT 'avatar' NOT NULL;