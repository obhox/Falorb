ALTER TABLE "waitlist_entries" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "blog_publish_targets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_contacts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_deal_stages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_deals" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_list_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_lists" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_run_profile_tracks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_run_profiles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_sent_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_signal_mappings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_signal_pushes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_signal_rules" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_suppressions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_workflows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_businesses" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_conversations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_escalations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_inbound_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_leads" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_tickets" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_charges" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_customers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_invoices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_channels" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "social_posts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospect_keywords" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospects" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ugc_video_post_queue" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ugc_videos" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_accounts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "waitlist_entries" CASCADE;--> statement-breakpoint
DROP TABLE "blog_publish_targets" CASCADE;--> statement-breakpoint
DROP TABLE "crm_contacts" CASCADE;--> statement-breakpoint
DROP TABLE "crm_deal_stages" CASCADE;--> statement-breakpoint
DROP TABLE "crm_deals" CASCADE;--> statement-breakpoint
DROP TABLE "crm_list_members" CASCADE;--> statement-breakpoint
DROP TABLE "crm_lists" CASCADE;--> statement-breakpoint
DROP TABLE "crm_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "crm_run_profile_tracks" CASCADE;--> statement-breakpoint
DROP TABLE "crm_run_profiles" CASCADE;--> statement-breakpoint
DROP TABLE "crm_runs" CASCADE;--> statement-breakpoint
DROP TABLE "crm_sent_messages" CASCADE;--> statement-breakpoint
DROP TABLE "crm_signal_mappings" CASCADE;--> statement-breakpoint
DROP TABLE "crm_signal_pushes" CASCADE;--> statement-breakpoint
DROP TABLE "crm_signal_rules" CASCADE;--> statement-breakpoint
DROP TABLE "crm_suppressions" CASCADE;--> statement-breakpoint
DROP TABLE "crm_workflows" CASCADE;--> statement-breakpoint
DROP TABLE "support_businesses" CASCADE;--> statement-breakpoint
DROP TABLE "support_conversations" CASCADE;--> statement-breakpoint
DROP TABLE "support_escalations" CASCADE;--> statement-breakpoint
DROP TABLE "support_inbound_events" CASCADE;--> statement-breakpoint
DROP TABLE "support_leads" CASCADE;--> statement-breakpoint
DROP TABLE "support_tickets" CASCADE;--> statement-breakpoint
DROP TABLE "stripe_charges" CASCADE;--> statement-breakpoint
DROP TABLE "stripe_customers" CASCADE;--> statement-breakpoint
DROP TABLE "stripe_invoices" CASCADE;--> statement-breakpoint
DROP TABLE "stripe_subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE "social_channels" CASCADE;--> statement-breakpoint
DROP TABLE "social_posts" CASCADE;--> statement-breakpoint
DROP TABLE "prospect_keywords" CASCADE;--> statement-breakpoint
DROP TABLE "prospects" CASCADE;--> statement-breakpoint
DROP TABLE "ugc_video_post_queue" CASCADE;--> statement-breakpoint
DROP TABLE "ugc_videos" CASCADE;--> statement-breakpoint
DROP TABLE "email_accounts" CASCADE;--> statement-breakpoint
DROP TABLE "email_messages" CASCADE;--> statement-breakpoint
--- Hand-added IF EXISTS: `DROP TABLE "email_accounts" CASCADE` above has
--- already taken this foreign key with it, so the bare DROP CONSTRAINT
--- drizzle generates aborts the migration on any database that actually
--- had the constraint.
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_email_account_id_email_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "integration_connections" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
--- Hand-added: the recreated enum below has no value for the removed
--- providers, so the USING cast at the end of this block would abort the
--- whole migration on any deployment that has one of them connected. Their
--- clients, mirror tables and dashboard surfaces are gone in this same
--- migration, so the rows have nothing left to drive — drop them rather
--- than leaving a credential row addressed to a provider that no longer
--- exists.
DELETE FROM "integration_connections" WHERE "provider" NOT IN ('firecrawl', 'openrouter', 'router', 'gemini');--> statement-breakpoint
DROP TYPE "public"."integration_provider";--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('firecrawl', 'openrouter', 'router', 'gemini');--> statement-breakpoint
ALTER TABLE "integration_connections" ALTER COLUMN "provider" SET DATA TYPE "public"."integration_provider" USING "provider"::"public"."integration_provider";--> statement-breakpoint
DROP INDEX "projects_waitlist_token_uq";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "waitlist_token";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "profile_summary";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "profile_icp";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "profile_key_features";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "profile_suggested_keywords";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "profile_raw";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "profile_crawled_at";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "profile_crawl_failed_at";--> statement-breakpoint
ALTER TABLE "content_drafts" DROP COLUMN "publish_status";--> statement-breakpoint
ALTER TABLE "content_drafts" DROP COLUMN "published_at";--> statement-breakpoint
ALTER TABLE "content_drafts" DROP COLUMN "published_url";--> statement-breakpoint
ALTER TABLE "content_drafts" DROP COLUMN "publish_commit_sha";--> statement-breakpoint
ALTER TABLE "content_drafts" DROP COLUMN "publish_file_path";--> statement-breakpoint
ALTER TABLE "content_drafts" DROP COLUMN "publish_error";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN "email_account_id";--> statement-breakpoint
DROP TYPE "public"."content_draft_publish_status";--> statement-breakpoint
DROP TYPE "public"."email_account_status";--> statement-breakpoint
DROP TYPE "public"."email_direction";