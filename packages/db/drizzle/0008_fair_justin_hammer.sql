CREATE TYPE "public"."integration_provider" AS ENUM('linki', 'bund_ai');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'revoked', 'error');--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" "integration_status" DEFAULT 'active' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_org_provider_uq" ON "integration_connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "integration_connections_org_idx" ON "integration_connections" USING btree ("organization_id");