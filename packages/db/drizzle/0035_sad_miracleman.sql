CREATE TYPE "public"."mcp_auth_mode" AS ENUM('api_key', 'oauth');--> statement-breakpoint
CREATE TABLE "mcp_oauth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"encrypted_state" text NOT NULL,
	"state_iv" text NOT NULL,
	"state_auth_tag" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "auth_mode" "mcp_auth_mode" DEFAULT 'api_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "encrypted_oauth" text;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "oauth_iv" text;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD COLUMN "oauth_auth_tag" text;--> statement-breakpoint
ALTER TABLE "mcp_oauth_attempts" ADD CONSTRAINT "mcp_oauth_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_oauth_attempts" ADD CONSTRAINT "mcp_oauth_attempts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_attempts_org_idx" ON "mcp_oauth_attempts" USING btree ("organization_id");