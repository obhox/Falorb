ALTER TABLE "projects" ADD COLUMN "profile_summary" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profile_icp" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profile_key_features" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profile_suggested_keywords" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profile_raw" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profile_crawled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profile_crawl_failed_at" timestamp with time zone;