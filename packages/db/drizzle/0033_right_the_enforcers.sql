CREATE TYPE "public"."mcp_connection_status" AS ENUM('active', 'revoked', 'error');--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"encrypted_api_key" text,
	"iv" text,
	"auth_tag" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" "mcp_connection_status" DEFAULT 'active' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"tools_cache" jsonb,
	"tools_cached_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_org_name_uq" ON "mcp_connections" USING btree ("organization_id","name") WHERE "mcp_connections"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "mcp_connections_org_idx" ON "mcp_connections" USING btree ("organization_id");