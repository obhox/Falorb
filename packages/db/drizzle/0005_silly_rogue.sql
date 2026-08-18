ALTER TABLE "projects" ADD COLUMN "link_domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_link_domain_uq" ON "projects" USING btree ("link_domain");