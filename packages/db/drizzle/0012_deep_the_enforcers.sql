ALTER TYPE "public"."integration_provider" ADD VALUE 'clay';--> statement-breakpoint
CREATE TABLE "prospect_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" integer NOT NULL,
	"keyword" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" integer,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"source_url" text NOT NULL,
	"source_type" text NOT NULL,
	"author_handle" text,
	"title" text,
	"excerpt" text NOT NULL,
	"matched_keywords" text[] DEFAULT '{}' NOT NULL,
	"posted_at" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"relevance_score" integer,
	"relevance_rationale" text,
	"contact_name" text,
	"contact_email" text,
	"contact_title" text,
	"contact_linkedin_url" text,
	"contact_company_domain" text,
	"enrichment_raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enriched_at" timestamp with time zone,
	"enrichment_failed_at" timestamp with time zone,
	"status" text DEFAULT 'new' NOT NULL,
	"contacted_at" timestamp with time zone,
	"contacted_by" text,
	"dismissed_at" timestamp with time zone,
	"person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospect_keywords" ADD CONSTRAINT "prospect_keywords_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_keywords" ADD CONSTRAINT "prospect_keywords_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_contacted_by_user_id_fk" FOREIGN KEY ("contacted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_keywords_project_keyword_uq" ON "prospect_keywords" USING btree ("project_id","keyword");--> statement-breakpoint
CREATE INDEX "prospect_keywords_project_idx" ON "prospect_keywords" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_org_source_uq" ON "prospects" USING btree ("organization_id","source","source_id");--> statement-breakpoint
CREATE INDEX "prospects_org_status_idx" ON "prospects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "prospects_org_created_idx" ON "prospects" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "prospects_project_idx" ON "prospects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prospects_person_idx" ON "prospects" USING btree ("person_id");