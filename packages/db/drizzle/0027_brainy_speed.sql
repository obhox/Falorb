CREATE TYPE "public"."content_draft_publish_status" AS ENUM('draft', 'publishing', 'published', 'failed');--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'github';--> statement-breakpoint
CREATE TABLE "blog_publish_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_connection_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"path_template" text DEFAULT 'content/blog/{slug}.md' NOT NULL,
	"frontmatter_template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "publish_status" "content_draft_publish_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "published_url" text;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "publish_commit_sha" text;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "publish_file_path" text;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD COLUMN "publish_error" text;--> statement-breakpoint
ALTER TABLE "blog_publish_targets" ADD CONSTRAINT "blog_publish_targets_integration_connection_id_integration_connections_id_fk" FOREIGN KEY ("integration_connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blog_publish_targets_connection_uq" ON "blog_publish_targets" USING btree ("integration_connection_id");