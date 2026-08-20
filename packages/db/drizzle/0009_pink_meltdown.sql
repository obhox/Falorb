CREATE TABLE "crm_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"person_id" uuid,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"title" text,
	"company" text,
	"company_linki_id" text,
	"location" text,
	"linkedin_url" text,
	"owner_linki_id" text,
	"linki_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_list_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"list_linki_id" text NOT NULL,
	"target_linki_id" text NOT NULL,
	"list_id" uuid,
	"contact_id" uuid,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"purpose" text,
	"linki_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"target_linki_id" text,
	"stage_linki_id" text,
	"contact_id" uuid,
	"stage_id" uuid,
	"name" text NOT NULL,
	"amount" numeric,
	"currency" text,
	"expected_close_date" timestamp with time zone,
	"source" text,
	"linki_created_at" timestamp with time zone,
	"linki_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"is_lost" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_run_profile_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"run_profile_linki_id" text NOT NULL,
	"run_linki_id" text NOT NULL,
	"target_linki_id" text NOT NULL,
	"run_id" uuid,
	"contact_id" uuid,
	"track" text,
	"state" text,
	"current_step" integer,
	"last_step_at" timestamp with time zone,
	"next_step_at" timestamp with time zone,
	"error_message" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_run_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"run_linki_id" text NOT NULL,
	"target_linki_id" text NOT NULL,
	"run_id" uuid,
	"contact_id" uuid,
	"linki_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"workflow_linki_id" text,
	"list_linki_id" text,
	"workflow_id" uuid,
	"list_id" uuid,
	"status" text,
	"linki_created_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"target_linki_id" text,
	"run_linki_id" text,
	"contact_id" uuid,
	"recipient" text,
	"subject" text,
	"status" text,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_signal_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"linki_signal_type" text NOT NULL,
	"linki_source" text DEFAULT 'falorb' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_signal_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"mapping_id" uuid,
	"person_id" uuid,
	"contact_id" uuid,
	"signal_type" text NOT NULL,
	"score" numeric,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"linki_signal_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_signal_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"name" text NOT NULL,
	"signal_type" text NOT NULL,
	"min_score" numeric DEFAULT '0' NOT NULL,
	"list_linki_id" text,
	"workflow_linki_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_start" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"target_linki_id" text,
	"linki_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"linki_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"linki_created_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bund_ai_id" text NOT NULL,
	"name" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bund_ai_id" text NOT NULL,
	"person_id" uuid,
	"channel" text,
	"external_user_ref" text,
	"status" text,
	"started_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bund_ai_id" text NOT NULL,
	"conversation_bund_ai_id" text,
	"conversation_id" uuid,
	"person_id" uuid,
	"reason" text,
	"summary" text,
	"status" text,
	"customer_contact" text,
	"bund_ai_created_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bund_ai_id" text NOT NULL,
	"conversation_bund_ai_id" text,
	"conversation_id" uuid,
	"person_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"intent" text,
	"notes" text,
	"status" text,
	"bund_ai_created_at" timestamp with time zone,
	"bund_ai_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bund_ai_id" text NOT NULL,
	"conversation_bund_ai_id" text,
	"conversation_id" uuid,
	"person_id" uuid,
	"subject" text,
	"description" text,
	"category" text,
	"priority" text,
	"status" text,
	"customer_name" text,
	"customer_contact" text,
	"created_by" text,
	"bund_ai_created_at" timestamp with time zone,
	"bund_ai_updated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_list_members" ADD CONSTRAINT "crm_list_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_list_members" ADD CONSTRAINT "crm_list_members_list_id_crm_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."crm_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_list_members" ADD CONSTRAINT "crm_list_members_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lists" ADD CONSTRAINT "crm_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_id_crm_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_run_profile_tracks" ADD CONSTRAINT "crm_run_profile_tracks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_run_profile_tracks" ADD CONSTRAINT "crm_run_profile_tracks_run_id_crm_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crm_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_run_profile_tracks" ADD CONSTRAINT "crm_run_profile_tracks_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_run_profiles" ADD CONSTRAINT "crm_run_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_run_profiles" ADD CONSTRAINT "crm_run_profiles_run_id_crm_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crm_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_run_profiles" ADD CONSTRAINT "crm_run_profiles_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_runs" ADD CONSTRAINT "crm_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_runs" ADD CONSTRAINT "crm_runs_workflow_id_crm_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."crm_workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_runs" ADD CONSTRAINT "crm_runs_list_id_crm_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."crm_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sent_messages" ADD CONSTRAINT "crm_sent_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sent_messages" ADD CONSTRAINT "crm_sent_messages_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signal_mappings" ADD CONSTRAINT "crm_signal_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signal_pushes" ADD CONSTRAINT "crm_signal_pushes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signal_pushes" ADD CONSTRAINT "crm_signal_pushes_mapping_id_crm_signal_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."crm_signal_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signal_pushes" ADD CONSTRAINT "crm_signal_pushes_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signal_pushes" ADD CONSTRAINT "crm_signal_pushes_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_signal_rules" ADD CONSTRAINT "crm_signal_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_suppressions" ADD CONSTRAINT "crm_suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_workflows" ADD CONSTRAINT "crm_workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_businesses" ADD CONSTRAINT "support_businesses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_escalations" ADD CONSTRAINT "support_escalations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_escalations" ADD CONSTRAINT "support_escalations_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_escalations" ADD CONSTRAINT "support_escalations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_inbound_events" ADD CONSTRAINT "support_inbound_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_leads" ADD CONSTRAINT "support_leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_leads" ADD CONSTRAINT "support_leads_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_leads" ADD CONSTRAINT "support_leads_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_org_linki_uq" ON "crm_contacts" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_org_email_idx" ON "crm_contacts" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "crm_contacts_person_idx" ON "crm_contacts" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_list_members_org_pair_uq" ON "crm_list_members" USING btree ("organization_id","list_linki_id","target_linki_id");--> statement-breakpoint
CREATE INDEX "crm_list_members_list_idx" ON "crm_list_members" USING btree ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_lists_org_linki_uq" ON "crm_lists" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_opportunities_org_linki_uq" ON "crm_opportunities" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipeline_stages_org_linki_uq" ON "crm_pipeline_stages" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_run_profile_tracks_org_linki_uq" ON "crm_run_profile_tracks" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE INDEX "crm_run_profile_tracks_run_idx" ON "crm_run_profile_tracks" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_run_profiles_org_linki_uq" ON "crm_run_profiles" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE INDEX "crm_run_profiles_run_idx" ON "crm_run_profiles" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_runs_org_linki_uq" ON "crm_runs" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_sent_messages_org_linki_uq" ON "crm_sent_messages" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE INDEX "crm_signal_mappings_org_idx" ON "crm_signal_mappings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "crm_signal_pushes_org_idx" ON "crm_signal_pushes" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_signal_pushes_person_idx" ON "crm_signal_pushes" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_signal_rules_org_linki_uq" ON "crm_signal_rules" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_suppressions_org_linki_uq" ON "crm_suppressions" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE INDEX "crm_suppressions_org_value_idx" ON "crm_suppressions" USING btree ("organization_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_workflows_org_linki_uq" ON "crm_workflows" USING btree ("organization_id","linki_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_businesses_org_bund_ai_uq" ON "support_businesses" USING btree ("organization_id","bund_ai_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_conversations_org_bund_ai_uq" ON "support_conversations" USING btree ("organization_id","bund_ai_id");--> statement-breakpoint
CREATE INDEX "support_conversations_person_idx" ON "support_conversations" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_escalations_org_bund_ai_uq" ON "support_escalations" USING btree ("organization_id","bund_ai_id");--> statement-breakpoint
CREATE INDEX "support_escalations_org_status_idx" ON "support_escalations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "support_escalations_person_idx" ON "support_escalations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "support_inbound_events_org_processed_idx" ON "support_inbound_events" USING btree ("organization_id","processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_leads_org_bund_ai_uq" ON "support_leads" USING btree ("organization_id","bund_ai_id");--> statement-breakpoint
CREATE INDEX "support_leads_org_email_idx" ON "support_leads" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "support_leads_person_idx" ON "support_leads" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_org_bund_ai_uq" ON "support_tickets" USING btree ("organization_id","bund_ai_id");--> statement-breakpoint
CREATE INDEX "support_tickets_org_status_idx" ON "support_tickets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "support_tickets_person_idx" ON "support_tickets" USING btree ("person_id");