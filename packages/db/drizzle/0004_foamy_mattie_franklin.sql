CREATE TABLE "referral_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" integer NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"destination_url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "first_referral_code" text;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_links_code_uq" ON "referral_links" USING btree ("code");--> statement-breakpoint
CREATE INDEX "referral_links_project_idx" ON "referral_links" USING btree ("project_id");