ALTER TYPE "public"."integration_provider" ADD VALUE 'buffer' BEFORE 'clay';--> statement-breakpoint
CREATE TABLE "social_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"buffer_id" text NOT NULL,
	"service" text,
	"name" text,
	"display_name" text,
	"avatar" text,
	"timezone" text,
	"is_disconnected" boolean DEFAULT false NOT NULL,
	"is_queue_paused" boolean DEFAULT false NOT NULL,
	"weekly_posting_limit" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"buffer_id" text NOT NULL,
	"channel_buffer_id" text NOT NULL,
	"channel_id" uuid,
	"text" text,
	"status" text,
	"share_mode" text,
	"scheduling_type" text,
	"due_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"tags" jsonb,
	"metrics" jsonb,
	"metrics_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_channels" ADD CONSTRAINT "social_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_channel_id_social_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."social_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_channels_org_buffer_uq" ON "social_channels" USING btree ("organization_id","buffer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_posts_org_buffer_uq" ON "social_posts" USING btree ("organization_id","buffer_id");--> statement-breakpoint
CREATE INDEX "social_posts_channel_idx" ON "social_posts" USING btree ("channel_id");