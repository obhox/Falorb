DROP INDEX "stripe_charges_org_stripe_uq";--> statement-breakpoint
DROP INDEX "stripe_customers_org_stripe_uq";--> statement-breakpoint
DROP INDEX "stripe_invoices_org_stripe_uq";--> statement-breakpoint
DROP INDEX "stripe_subscriptions_org_stripe_uq";--> statement-breakpoint
ALTER TABLE "stripe_charges" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "stripe_invoices" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD COLUMN "project_id" integer;--> statement-breakpoint
ALTER TABLE "stripe_charges" ADD CONSTRAINT "stripe_charges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_invoices" ADD CONSTRAINT "stripe_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD CONSTRAINT "stripe_subscriptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_charges_project_stripe_uq" ON "stripe_charges" USING btree ("organization_id","project_id","stripe_id") WHERE "stripe_charges"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "stripe_charges_project_idx" ON "stripe_charges" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_project_stripe_uq" ON "stripe_customers" USING btree ("organization_id","project_id","stripe_id") WHERE "stripe_customers"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "stripe_customers_project_idx" ON "stripe_customers" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_invoices_project_stripe_uq" ON "stripe_invoices" USING btree ("organization_id","project_id","stripe_id") WHERE "stripe_invoices"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "stripe_invoices_project_idx" ON "stripe_invoices" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_subscriptions_project_stripe_uq" ON "stripe_subscriptions" USING btree ("organization_id","project_id","stripe_id") WHERE "stripe_subscriptions"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "stripe_subscriptions_project_idx" ON "stripe_subscriptions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_charges_org_stripe_uq" ON "stripe_charges" USING btree ("organization_id","stripe_id") WHERE "stripe_charges"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_org_stripe_uq" ON "stripe_customers" USING btree ("organization_id","stripe_id") WHERE "stripe_customers"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_invoices_org_stripe_uq" ON "stripe_invoices" USING btree ("organization_id","stripe_id") WHERE "stripe_invoices"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_subscriptions_org_stripe_uq" ON "stripe_subscriptions" USING btree ("organization_id","stripe_id") WHERE "stripe_subscriptions"."project_id" is null;