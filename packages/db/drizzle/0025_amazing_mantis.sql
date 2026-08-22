ALTER TYPE "public"."integration_provider" ADD VALUE 'stripe' BEFORE 'openrouter';--> statement-breakpoint
CREATE TABLE "stripe_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"stripe_id" text NOT NULL,
	"customer_stripe_id" text,
	"customer_id" uuid,
	"amount" integer NOT NULL,
	"amount_refunded" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"refunded" boolean DEFAULT false NOT NULL,
	"disputed" boolean DEFAULT false NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"description" text,
	"receipt_url" text,
	"stripe_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"stripe_id" text NOT NULL,
	"person_id" uuid,
	"email" text,
	"name" text,
	"phone" text,
	"currency" text,
	"delinquent" boolean,
	"stripe_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"stripe_id" text NOT NULL,
	"customer_stripe_id" text,
	"customer_id" uuid,
	"subscription_stripe_id" text,
	"subscription_id" uuid,
	"status" text,
	"amount_due" integer NOT NULL,
	"amount_paid" integer NOT NULL,
	"amount_remaining" integer NOT NULL,
	"currency" text NOT NULL,
	"number" text,
	"hosted_invoice_url" text,
	"invoice_pdf" text,
	"due_date" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"stripe_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"stripe_id" text NOT NULL,
	"customer_stripe_id" text NOT NULL,
	"customer_id" uuid,
	"status" text NOT NULL,
	"amount_per_cycle" integer NOT NULL,
	"currency" text NOT NULL,
	"interval" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"monthly_amount_estimate" integer NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"stripe_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_charges" ADD CONSTRAINT "stripe_charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_charges" ADD CONSTRAINT "stripe_charges_customer_id_stripe_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."stripe_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_invoices" ADD CONSTRAINT "stripe_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_invoices" ADD CONSTRAINT "stripe_invoices_customer_id_stripe_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."stripe_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_invoices" ADD CONSTRAINT "stripe_invoices_subscription_id_stripe_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."stripe_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD CONSTRAINT "stripe_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD CONSTRAINT "stripe_subscriptions_customer_id_stripe_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."stripe_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_charges_org_stripe_uq" ON "stripe_charges" USING btree ("organization_id","stripe_id");--> statement-breakpoint
CREATE INDEX "stripe_charges_customer_idx" ON "stripe_charges" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "stripe_charges_org_status_idx" ON "stripe_charges" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_org_stripe_uq" ON "stripe_customers" USING btree ("organization_id","stripe_id");--> statement-breakpoint
CREATE INDEX "stripe_customers_org_email_idx" ON "stripe_customers" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "stripe_customers_person_idx" ON "stripe_customers" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_invoices_org_stripe_uq" ON "stripe_invoices" USING btree ("organization_id","stripe_id");--> statement-breakpoint
CREATE INDEX "stripe_invoices_customer_idx" ON "stripe_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "stripe_invoices_org_status_idx" ON "stripe_invoices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_subscriptions_org_stripe_uq" ON "stripe_subscriptions" USING btree ("organization_id","stripe_id");--> statement-breakpoint
CREATE INDEX "stripe_subscriptions_customer_idx" ON "stripe_subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "stripe_subscriptions_org_status_idx" ON "stripe_subscriptions" USING btree ("organization_id","status");