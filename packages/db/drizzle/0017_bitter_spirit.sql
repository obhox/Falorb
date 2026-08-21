DROP INDEX "integration_connections_org_provider_uq";--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_project_provider_uq" ON "integration_connections" USING btree ("organization_id","project_id","provider") WHERE "integration_connections"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "integration_connections_project_idx" ON "integration_connections" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_org_provider_uq" ON "integration_connections" USING btree ("organization_id","provider") WHERE "integration_connections"."project_id" is null;