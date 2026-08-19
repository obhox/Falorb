CREATE TABLE "content_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" integer NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"meta_description" text NOT NULL,
	"body" text NOT NULL,
	"created_by" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" integer NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"referral_code" text NOT NULL,
	"referred_by_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "weekly_digest_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "waitlist_token" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "contacted_by" text;--> statement-breakpoint
ALTER TABLE "referral_links" ADD COLUMN "incentive_kind" text;--> statement-breakpoint
ALTER TABLE "referral_links" ADD COLUMN "incentive_value" text;--> statement-breakpoint
ALTER TABLE "referral_links" ADD COLUMN "incentive_description" text;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_drafts_project_idx" ON "content_drafts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "content_drafts_org_idx" ON "content_drafts" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_project_email_uq" ON "waitlist_entries" USING btree ("project_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_referral_code_uq" ON "waitlist_entries" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "waitlist_entries_project_idx" ON "waitlist_entries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_referred_by_idx" ON "waitlist_entries" USING btree ("referred_by_code");--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_contacted_by_user_id_fk" FOREIGN KEY ("contacted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_waitlist_token_uq" ON "projects" USING btree ("waitlist_token");