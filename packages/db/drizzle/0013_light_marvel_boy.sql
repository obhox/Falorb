CREATE TABLE "ugc_video_post_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"caption" text,
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ugc_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" integer,
	"brief" text NOT NULL,
	"script" text,
	"voice_id" text NOT NULL,
	"audio_base64" text,
	"audio_mime_type" text,
	"presenter_image_base64" text NOT NULL,
	"presenter_image_mime_type" text NOT NULL,
	"video_model" text NOT NULL,
	"elevenlabs_generation_id" text,
	"video_url" text,
	"duration_seconds" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"processing_started_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ugc_video_post_queue" ADD CONSTRAINT "ugc_video_post_queue_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ugc_video_post_queue" ADD CONSTRAINT "ugc_video_post_queue_video_id_ugc_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."ugc_videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ugc_video_post_queue" ADD CONSTRAINT "ugc_video_post_queue_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD CONSTRAINT "ugc_videos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD CONSTRAINT "ugc_videos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ugc_videos" ADD CONSTRAINT "ugc_videos_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ugc_video_post_queue_org_idx" ON "ugc_video_post_queue" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ugc_video_post_queue_video_idx" ON "ugc_video_post_queue" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "ugc_videos_org_idx" ON "ugc_videos" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ugc_videos_org_status_idx" ON "ugc_videos" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "ugc_videos_project_idx" ON "ugc_videos" USING btree ("project_id");