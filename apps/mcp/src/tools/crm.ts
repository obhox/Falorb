import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema } from "@falorb/db";
import { LinkiApiError, type LinkiSignalType } from "@falorb/linki-client";
import type { McpContext } from "../context";
import { requireCapability, requireScope } from "../context";
import { getLinkiClient } from "../clients";
import { ago, failure, money, table, text } from "../format";

const SIGNAL_TYPES = ["job_change", "funding", "hiring", "technology", "product_intent", "custom"] as const;

/**
 * CRM — a read-only mirror of Linki (sales/outreach), refreshed every 15
 * minutes by `apps/worker/src/jobs/linki-sync.ts`, plus two write tools that
 * reach Linki itself (see FEATURES.md §13).
 *
 * The read tools work against `packages/db/src/schema/crm.ts`'s mirror
 * tables directly, the same tables `packages/agents/src/tools/crm.ts` reads
 * for the agent runtime — a research pass costs nothing and cannot
 * rate-limit the sync job it depends on. The two write tools mirror that
 * same file's `crm_create_contact`/`crm_push_signal` exactly, including its
 * two enforced rules: the suppression list is checked before any signal is
 * pushed, and a contact is never created twice for the same person.
 * Connecting/disconnecting Linki's credential itself is not exposed here —
 * see `integrations.ts`.
 */
export function registerCrmTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_crm_contacts",
    {
      title: "List CRM contacts",
      description:
        "Contacts mirrored from Linki, newest first. Optionally filtered by a name, company, " +
        "email or title fragment. Read-only view of the CRM as it stood at the last sync.",
      inputSchema: {
        search: z.string().optional().describe("Match against name, email, company or title."),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ search, limit }) => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.crmContacts)
          .where(eq(schema.crmContacts.organizationId, scope.organizationId))
          .orderBy(desc(schema.crmContacts.linkiCreatedAt))
          .limit(search ? 500 : limit);

        const filtered = search
          ? rows
              .filter((r) =>
                [r.fullName, r.email, r.company, r.title].some((v) =>
                  (v ?? "").toLowerCase().includes(search.toLowerCase()),
                ),
              )
              .slice(0, limit)
          : rows;

        return text(
          table(
            filtered,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Name", get: (r) => r.fullName },
              { header: "Email", get: (r) => r.email },
              { header: "Company", get: (r) => r.company },
              { header: "Title", get: (r) => r.title },
              { header: "Linked person", get: (r) => r.personId },
              { header: "Synced", get: (r) => ago(r.syncedAt.toISOString()) },
            ],
            "No CRM contacts mirrored yet — Linki may not be connected, or has never synced.",
          ) + "\n\nUse get_crm_contact for the full row, or get_person if a person is linked.",
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_crm_contact",
    {
      title: "Get one CRM contact",
      description:
        "Full mirrored detail for one Linki contact, including the Falorb-side status/owner/notes " +
        "extension when one has been added ('Add to CRM' in the dashboard).",
      inputSchema: { contact_id: z.string().describe("From list_crm_contacts.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ contact_id }) => {
      const { db, scope } = ctx();
      try {
        const [contact] = await db
          .select()
          .from(schema.crmContacts)
          .where(
            and(eq(schema.crmContacts.id, contact_id), eq(schema.crmContacts.organizationId, scope.organizationId)),
          )
          .limit(1);
        if (!contact) return failure("No such CRM contact.");

        const [profile] = contact.personId
          ? await db
              .select()
              .from(schema.crmProfiles)
              .where(eq(schema.crmProfiles.personId, contact.personId))
              .limit(1)
          : [null];

        const lines = [
          `# ${contact.fullName ?? "Unnamed contact"}`,
          "",
          `Email: ${contact.email ?? "—"}  ·  Phone: ${contact.phone ?? "—"}`,
          `Company: ${contact.company ?? "—"}  ·  Title: ${contact.title ?? "—"}`,
          `Location: ${contact.location ?? "—"}  ·  LinkedIn: ${contact.linkedinUrl ?? "—"}`,
          `Linki id: \`${contact.linkiId}\`  ·  Synced ${ago(contact.syncedAt.toISOString())}`,
          contact.personId
            ? `Linked Falorb person: \`${contact.personId}\` — call get_person for their full analytics profile.`
            : "Not linked to a Falorb person (no email match yet).",
        ];

        if (profile) {
          lines.push(
            "",
            "## Falorb CRM status",
            `Status: **${profile.status}**  ·  Owner: ${profile.ownerId ?? "unassigned"}`,
            profile.notes ? `Notes: ${profile.notes}` : "No notes.",
          );
        }

        return text(lines.join("\n"));
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_crm_deals",
    {
      title: "List the deal pipeline",
      description:
        "Falorb-native deals by stage, with amounts and owners — what is actually in play right " +
        "now. Open deals by default; set include_closed to see won/lost too.",
      inputSchema: {
        include_closed: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ include_closed, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.crmDeals.organizationId, scope.organizationId)];
        if (!include_closed) conditions.push(isNull(schema.crmDeals.closedAt));

        const rows = await db
          .select({
            id: schema.crmDeals.id,
            name: schema.crmDeals.name,
            amount: schema.crmDeals.amount,
            currency: schema.crmDeals.currency,
            stage: schema.crmDealStages.name,
            personId: schema.crmDeals.personId,
            expectedCloseDate: schema.crmDeals.expectedCloseDate,
            closedAt: schema.crmDeals.closedAt,
            updatedAt: schema.crmDeals.updatedAt,
          })
          .from(schema.crmDeals)
          .leftJoin(schema.crmDealStages, eq(schema.crmDeals.stageId, schema.crmDealStages.id))
          .where(and(...conditions))
          .orderBy(desc(schema.crmDeals.updatedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Deal", get: (r) => r.name },
              { header: "Stage", get: (r) => r.stage ?? "—" },
              { header: "Amount", get: (r) => money(r.amount, r.currency ?? "USD") },
              { header: "Expected close", get: (r) => r.expectedCloseDate?.toISOString().slice(0, 10) },
              { header: "Status", get: (r) => (r.closedAt ? "closed" : "open") },
              { header: "Updated", get: (r) => ago(r.updatedAt.toISOString()) },
            ],
            "No deals yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_crm_lists",
    {
      title: "List Linki lists",
      description: "Contact lists mirrored from Linki, with each list's stated purpose.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.crmLists)
          .where(eq(schema.crmLists.organizationId, scope.organizationId))
          .orderBy(desc(schema.crmLists.linkiCreatedAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Name", get: (r) => r.name },
              { header: "Purpose", get: (r) => r.purpose },
              { header: "Description", get: (r) => r.description },
            ],
            "No lists mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_crm_workflows",
    {
      title: "List Linki workflows",
      description: "Outreach workflows (sequences) mirrored from Linki. Use list_crm_runs to see who's running through one.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.crmWorkflows)
          .where(eq(schema.crmWorkflows.organizationId, scope.organizationId))
          .orderBy(desc(schema.crmWorkflows.linkiCreatedAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Name", get: (r) => r.name },
              { header: "Description", get: (r) => r.description },
            ],
            "No workflows mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_crm_runs",
    {
      title: "List workflow runs",
      description:
        "Workflow executions mirrored from Linki — a run enrolls a list of targets in a " +
        "workflow. Optionally filtered to one workflow. Per-target, per-channel send/reply " +
        "progress is not mirrored at this granularity; this is the run-level status only.",
      inputSchema: {
        workflow_id: z.string().optional().describe("From list_crm_workflows. Omit for every run."),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workflow_id, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.crmRuns.organizationId, scope.organizationId)];
        if (workflow_id) conditions.push(eq(schema.crmRuns.workflowId, workflow_id));

        const rows = await db
          .select({
            id: schema.crmRuns.id,
            workflow: schema.crmWorkflows.name,
            list: schema.crmLists.name,
            status: schema.crmRuns.status,
            startedAt: schema.crmRuns.startedAt,
            completedAt: schema.crmRuns.completedAt,
          })
          .from(schema.crmRuns)
          .leftJoin(schema.crmWorkflows, eq(schema.crmRuns.workflowId, schema.crmWorkflows.id))
          .leftJoin(schema.crmLists, eq(schema.crmRuns.listId, schema.crmLists.id))
          .where(and(...conditions))
          .orderBy(desc(schema.crmRuns.startedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Workflow", get: (r) => r.workflow ?? "—" },
              { header: "List", get: (r) => r.list ?? "—" },
              { header: "Status", get: (r) => r.status },
              { header: "Started", get: (r) => (r.startedAt ? ago(r.startedAt.toISOString()) : "—") },
              { header: "Completed", get: (r) => (r.completedAt ? ago(r.completedAt.toISOString()) : "—") },
            ],
            "No runs mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_crm_signal_rules",
    {
      title: "List signal-triggered campaign rules",
      description:
        "Linki's signal-triggered campaign rules, mirrored read-only — which workflow a signal " +
        "type will hit, the minimum score, and whether autoStart is on. Falorb never writes to " +
        "this table's Linki-side source.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select({
            id: schema.crmSignalRules.id,
            name: schema.crmSignalRules.name,
            signalType: schema.crmSignalRules.signalType,
            minScore: schema.crmSignalRules.minScore,
            enabled: schema.crmSignalRules.enabled,
            autoStart: schema.crmSignalRules.autoStart,
            workflow: schema.crmWorkflows.name,
          })
          .from(schema.crmSignalRules)
          .leftJoin(schema.crmWorkflows, eq(schema.crmSignalRules.workflowLinkiId, schema.crmWorkflows.linkiId))
          .where(eq(schema.crmSignalRules.organizationId, scope.organizationId))
          .orderBy(desc(schema.crmSignalRules.name));

        return text(
          table(
            rows,
            [
              { header: "Name", get: (r) => r.name },
              { header: "Signal type", get: (r) => r.signalType },
              { header: "Min score", get: (r) => r.minScore },
              { header: "Workflow", get: (r) => r.workflow ?? "—" },
              { header: "Enabled", get: (r) => (r.enabled ? "yes" : "no") },
              { header: "Auto-start", get: (r) => (r.autoStart ? "yes" : "no") },
            ],
            "No signal rules mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_crm_sent_messages",
    {
      title: "List sent outreach messages",
      description: "Outbound emails/messages mirrored from Linki, newest sync first, with delivery status.",
      inputSchema: {
        status: z.string().optional().describe("Filter by Linki's status string, e.g. \"delivered\" or \"bounced\"."),
        limit: z.number().int().min(1).max(200).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.crmSentMessages.organizationId, scope.organizationId)];
        if (status) conditions.push(eq(schema.crmSentMessages.status, status));

        const rows = await db
          .select()
          .from(schema.crmSentMessages)
          .where(and(...conditions))
          .orderBy(desc(schema.crmSentMessages.syncedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Recipient", get: (r) => r.recipient },
              { header: "Subject", get: (r) => r.subject },
              { header: "Status", get: (r) => r.status },
              { header: "Delivered", get: (r) => (r.deliveredAt ? ago(r.deliveredAt.toISOString()) : "—") },
              { header: "Bounced", get: (r) => (r.bouncedAt ? ago(r.bouncedAt.toISOString()) : "—") },
            ],
            "No sent messages mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_crm_suppressions",
    {
      title: "List the suppression list",
      description:
        "Emails/contacts Linki will never message, mirrored from Linki. Check this before " +
        "suggesting outreach to anyone — being on this list means they asked not to be contacted.",
      inputSchema: {
        search: z.string().optional().describe("Filter by email/value fragment."),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ search, limit }) => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.crmSuppressions)
          .where(eq(schema.crmSuppressions.organizationId, scope.organizationId))
          .orderBy(desc(schema.crmSuppressions.syncedAt))
          .limit(search ? 1000 : limit);

        const filtered = search
          ? rows.filter((r) => r.value.toLowerCase().includes(search.toLowerCase())).slice(0, limit)
          : rows;

        return text(
          table(
            filtered,
            [
              { header: "Kind", get: (r) => r.kind },
              { header: "Value", get: (r) => r.value },
              { header: "Reason", get: (r) => r.reason },
            ],
            "No suppressions mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_crm_contact",
    {
      title: "Create a Linki contact",
      description:
        "Create a contact in Linki for a person Falorb already knows about, and link the two. " +
        "Requires the person's LinkedIn URL — Linki has no contact without one. Refuses if the " +
        "person already has a linked contact (check get_crm_contact/get_person first). " +
        "Requires the write scope.",
      inputSchema: {
        person_id: z.string().uuid().describe("From list_people, search_people, or get_person."),
        linkedin_url: z.string().url().describe("The person's LinkedIn profile URL."),
        full_name: z.string().optional().describe("Overrides the name Falorb already holds."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ person_id, linkedin_url, full_name }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "manageCrm", "add a contact to the CRM");

        const [existing] = await db
          .select({ id: schema.crmContacts.id, linkiId: schema.crmContacts.linkiId })
          .from(schema.crmContacts)
          .where(
            and(
              eq(schema.crmContacts.organizationId, scope.organizationId),
              eq(schema.crmContacts.personId, person_id),
            ),
          )
          .limit(1);
        if (existing) return failure(`Already linked to Linki contact ${existing.linkiId}. Nothing to do.`);

        const [person] = await db
          .select()
          .from(schema.persons)
          .where(and(eq(schema.persons.id, person_id), eq(schema.persons.organizationId, scope.organizationId)))
          .limit(1);
        if (!person) return failure("No such person in this workspace.");

        const [company] = person.companyId
          ? await db.select().from(schema.companies).where(eq(schema.companies.id, person.companyId)).limit(1)
          : [null];

        const client = await getLinkiClient(db, scope.organizationId);
        if (!client) return failure("Linki isn't connected. Connect it in Settings → Integrations.");

        let contact;
        try {
          contact = await client.createContact({
            full_name: full_name ?? person.name ?? person.email ?? "Unknown",
            linkedin_url,
            email: person.email ?? undefined,
            company: company?.name ?? undefined,
            location: person.lastCountry ?? undefined,
          });
        } catch (error) {
          return failure(`Linki rejected the contact: ${error instanceof LinkiApiError ? error.message : String(error)}`);
        }

        await db.insert(schema.crmContacts).values({
          organizationId: scope.organizationId,
          linkiId: contact.id,
          personId: person_id,
          fullName: contact.full_name,
          email: contact.email,
          company: contact.company,
          location: contact.location,
          linkedinUrl: contact.linkedin_url,
        });

        return text(`Created Linki contact **${contact.full_name}**, id \`${contact.id}\`.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "push_crm_signal",
    {
      title: "Push a signal to Linki",
      description:
        "Tell Linki something changed about a contact — they came back to pricing, their company " +
        "raised, they changed jobs — so Linki's own rules can act on it. The person must already " +
        "be a linked contact (create_crm_contact first). Refuses anyone on the suppression list — " +
        "check list_crm_suppressions if unsure. Requires the write scope.",
      inputSchema: {
        person_id: z.string().uuid().describe("Must already have a linked Linki contact."),
        type: z.enum(SIGNAL_TYPES),
        title: z.string().min(1).max(200).describe("One line stating what happened."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ person_id, type, title }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "actOnIntegrations", "push a signal to Linki");

        const [contact] = await db
          .select()
          .from(schema.crmContacts)
          .where(
            and(
              eq(schema.crmContacts.organizationId, scope.organizationId),
              eq(schema.crmContacts.personId, person_id),
            ),
          )
          .limit(1);
        if (!contact) {
          return failure("This person is not linked to a Linki contact yet — call create_crm_contact first.");
        }

        if (contact.email) {
          const [suppressed] = await db
            .select({ id: schema.crmSuppressions.id })
            .from(schema.crmSuppressions)
            .where(
              and(
                eq(schema.crmSuppressions.organizationId, scope.organizationId),
                eq(schema.crmSuppressions.kind, "email"),
                eq(schema.crmSuppressions.value, contact.email),
              ),
            )
            .limit(1);
          if (suppressed) {
            return failure(`${contact.email} is on the suppression list. Do not contact them, and do not push this signal through another route.`);
          }
        }

        const [person] = await db
          .select({ leadScore: schema.persons.leadScore })
          .from(schema.persons)
          .where(eq(schema.persons.id, person_id))
          .limit(1);

        const client = await getLinkiClient(db, scope.organizationId);
        if (!client) return failure("Linki isn't connected. Connect it in Settings → Integrations.");

        try {
          const signal = await client.ingestSignal({
            type: type as LinkiSignalType,
            title,
            score: person?.leadScore ?? undefined,
            source: "falorb-mcp",
            target_id: contact.linkiId,
          });

          await db.insert(schema.crmSignalPushes).values({
            organizationId: scope.organizationId,
            personId: person_id,
            contactId: contact.id,
            signalType: type,
            score: person?.leadScore != null ? String(person.leadScore) : null,
            payload: { title, target_id: contact.linkiId },
            status: "sent",
            linkiSignalId: signal.id,
          });

          return text(`Pushed "${type}" signal to Linki for contact ${contact.linkiId}, signal id \`${signal.id}\`.`);
        } catch (error) {
          const detail = error instanceof LinkiApiError ? error.message : String(error);
          await db.insert(schema.crmSignalPushes).values({
            organizationId: scope.organizationId,
            personId: person_id,
            contactId: contact.id,
            signalType: type,
            payload: { title, target_id: contact.linkiId },
            status: "failed",
            error: detail,
          });
          return failure(`Linki rejected the push: ${detail}`);
        }
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
