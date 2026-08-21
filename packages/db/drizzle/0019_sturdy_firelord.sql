ALTER TABLE "social_channels" ADD COLUMN "buffer_organization_id" text;--> statement-breakpoint
ALTER TABLE "social_channels" ADD COLUMN "weekly_posting_limit_detail" jsonb;--> statement-breakpoint
ALTER TABLE "social_channels" ADD COLUMN "posting_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "social_channels" ADD COLUMN "posting_goal" jsonb;--> statement-breakpoint
ALTER TABLE "social_channels" ADD COLUMN "allowed_actions" jsonb;--> statement-breakpoint
ALTER TABLE "social_posts" ADD COLUMN "error_message" text;