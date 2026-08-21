ALTER TYPE "public"."integration_provider" ADD VALUE 'openrouter';--> statement-breakpoint
ALTER TYPE "public"."integration_provider" ADD VALUE 'router';--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "model" text;