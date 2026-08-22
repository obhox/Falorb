CREATE TABLE "agent_approval_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"granted_by" text,
	"approval_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "automation_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "automation_paused_by" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "approval_notify_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_approvals" ADD COLUMN "feedback_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_approval_grants" ADD CONSTRAINT "agent_approval_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval_grants" ADD CONSTRAINT "agent_approval_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval_grants" ADD CONSTRAINT "agent_approval_grants_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_approval_grants" ADD CONSTRAINT "agent_approval_grants_approval_id_agent_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."agent_approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_approval_grants_agent_tool_idx" ON "agent_approval_grants" USING btree ("agent_id","tool_name","expires_at");--> statement-breakpoint
CREATE INDEX "agent_approval_grants_org_idx" ON "agent_approval_grants" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_automation_paused_by_user_id_fk" FOREIGN KEY ("automation_paused_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;