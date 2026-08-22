CREATE TYPE "public"."email_account_status" AS ENUM('active', 'error', 'archived');--> statement-breakpoint
CREATE TYPE "public"."email_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'migadu' BEFORE 'openrouter';--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" integer,
	"domain" text NOT NULL,
	"local_part" text NOT NULL,
	"address" text NOT NULL,
	"name" text,
	"encrypted_password" text NOT NULL,
	"password_iv" text NOT NULL,
	"password_auth_tag" text NOT NULL,
	"password_key_version" integer DEFAULT 1 NOT NULL,
	"imap_uid_validity" integer,
	"imap_last_uid" integer DEFAULT 0 NOT NULL,
	"status" "email_account_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email_account_id" uuid NOT NULL,
	"direction" "email_direction" NOT NULL,
	"imap_uid" integer,
	"message_id" text,
	"in_reply_to" text,
	"from_address" text,
	"from_name" text,
	"to_addresses" jsonb,
	"cc_addresses" jsonb,
	"subject" text,
	"text_body" text,
	"html_body" text,
	"received_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_accounts_org_address_uq" ON "email_accounts" USING btree ("organization_id","address");--> statement-breakpoint
CREATE INDEX "email_accounts_org_idx" ON "email_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "email_accounts_project_idx" ON "email_accounts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_account_uid_uq" ON "email_messages" USING btree ("email_account_id","imap_uid") WHERE "email_messages"."imap_uid" is not null;--> statement-breakpoint
CREATE INDEX "email_messages_account_idx" ON "email_messages" USING btree ("email_account_id");--> statement-breakpoint
CREATE INDEX "email_messages_org_idx" ON "email_messages" USING btree ("organization_id");