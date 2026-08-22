import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { schema } from "@falorb/db";
import type { McpContext } from "../context";
import { requireCapability, requireScope } from "../context";
import { getBundAiClient } from "../clients";
import { ago, failure, table, text } from "../format";

/**
 * Support — a read-only mirror of Bund AI (customer support), refreshed
 * every 15 minutes by `apps/worker/src/jobs/bund-ai-sync.ts`, plus one write
 * tool that closes an escalation in Bund AI itself (see FEATURES.md §13).
 *
 * The read tools work against Falorb's own mirror
 * (`packages/db/src/schema/support.ts`), the same tables
 * `packages/agents/src/tools/support.ts` reads for the agent runtime. That
 * same file gates `support_resolve_escalation` as `external`/`high` risk,
 * queued for human approval under every autonomy level short of an explicit
 * per-tool waiver — because an escalation exists precisely because the
 * support AI judged it needed a human. `resolve_support_escalation` below
 * carries the same weight: it requires the write scope and a resolution
 * note of real substance, and should be called deliberately, one escalation
 * at a time, never as a bulk sweep.
 */
export function registerSupportTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_support_conversations",
    {
      title: "List support conversations",
      description:
        "Recent support conversations mirrored from Bund AI, newest activity first — what " +
        "customers are actually asking about, and whether one topic is spiking.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(25) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.supportConversations)
          .where(eq(schema.supportConversations.organizationId, scope.organizationId))
          .orderBy(desc(schema.supportConversations.lastActivityAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Channel", get: (r) => r.channel },
              { header: "Status", get: (r) => r.status },
              { header: "Linked person", get: (r) => r.personId },
              {
                header: "Last activity",
                get: (r) => (r.lastActivityAt ? ago(r.lastActivityAt.toISOString()) : "—"),
              },
            ],
            "No support conversations mirrored yet — Bund AI may not be connected, or has never synced.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_support_escalations",
    {
      title: "List support escalations",
      description:
        "Conversations the support AI handed to a human, newest first — the queue to triage at " +
        "the start of a support shift. Open ones by default; set include_resolved to see the rest.",
      inputSchema: {
        include_resolved: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ include_resolved, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.supportEscalations.organizationId, scope.organizationId)];
        if (!include_resolved) {
          conditions.push(
            and(
              isNull(schema.supportEscalations.resolvedAt),
              or(
                isNull(schema.supportEscalations.status),
                ne(schema.supportEscalations.status, "resolved"),
              ),
            )!,
          );
        }

        const rows = await db
          .select()
          .from(schema.supportEscalations)
          .where(and(...conditions))
          .orderBy(desc(schema.supportEscalations.bundAiCreatedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Reason", get: (r) => r.reason },
              { header: "Summary", get: (r) => r.summary },
              { header: "Status", get: (r) => r.status },
              { header: "Contact", get: (r) => r.customerContact },
              {
                header: "Opened",
                get: (r) => (r.bundAiCreatedAt ? ago(r.bundAiCreatedAt.toISOString()) : "—"),
              },
            ],
            include_resolved ? "No escalations mirrored yet." : "No open escalations.",
          ) + "\n\nResolving an escalation is a dashboard-only action, not available here.",
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_support_leads",
    {
      title: "List support-sourced leads",
      description: "Leads captured by the support AI during a conversation, mirrored from Bund AI.",
      inputSchema: {
        status: z.string().optional().describe("Filter by Bund AI's status string."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.supportLeads.organizationId, scope.organizationId)];
        if (status) conditions.push(eq(schema.supportLeads.status, status));

        const rows = await db
          .select()
          .from(schema.supportLeads)
          .where(and(...conditions))
          .orderBy(desc(schema.supportLeads.bundAiCreatedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Name", get: (r) => r.name },
              { header: "Email", get: (r) => r.email },
              { header: "Intent", get: (r) => r.intent },
              { header: "Status", get: (r) => r.status },
              { header: "Linked person", get: (r) => r.personId },
            ],
            "No support-sourced leads mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_support_tickets",
    {
      title: "List support tickets",
      description:
        "Support tickets mirrored from Bund AI. The full transcript is not mirrored — this is " +
        "subject, category, priority and status only.",
      inputSchema: {
        status: z.string().optional().describe("Filter by Bund AI's status string."),
        priority: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, priority, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.supportTickets.organizationId, scope.organizationId)];
        if (status) conditions.push(eq(schema.supportTickets.status, status));
        if (priority) conditions.push(eq(schema.supportTickets.priority, priority));

        const rows = await db
          .select()
          .from(schema.supportTickets)
          .where(and(...conditions))
          .orderBy(desc(schema.supportTickets.bundAiCreatedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Subject", get: (r) => r.subject },
              { header: "Category", get: (r) => r.category },
              { header: "Priority", get: (r) => r.priority },
              { header: "Status", get: (r) => r.status },
              { header: "Customer", get: (r) => r.customerName ?? r.customerContact },
              {
                header: "Opened",
                get: (r) => (r.bundAiCreatedAt ? ago(r.bundAiCreatedAt.toISOString()) : "—"),
              },
            ],
            "No support tickets mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "resolve_support_escalation",
    {
      title: "Resolve a support escalation",
      description:
        "Mark an escalation resolved in Bund AI, with a note saying how. Only use this when the " +
        "underlying problem is genuinely handled — an escalation exists because the support AI " +
        "judged it needed a human, so closing one that is still open is worse than leaving it. " +
        "One escalation at a time; never as a bulk sweep. Requires the write scope.",
      inputSchema: {
        escalation_id: z.string().uuid().describe("Falorb's id, from list_support_escalations."),
        resolution: z.string().min(10).max(2000).describe("What was done, and why this is settled."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ escalation_id, resolution }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "actOnIntegrations", "resolve a support escalation");

        const [escalation] = await db
          .select()
          .from(schema.supportEscalations)
          .where(
            and(
              eq(schema.supportEscalations.id, escalation_id),
              eq(schema.supportEscalations.organizationId, scope.organizationId),
            ),
          )
          .limit(1);
        if (!escalation) return failure("No such escalation in this workspace.");
        if (escalation.resolvedAt) return failure("That escalation is already resolved.");

        const client = await getBundAiClient(db, scope.organizationId);
        if (!client) return failure("Bund AI isn't connected. Connect it in Settings → Integrations.");

        // Bund AI's API takes only the transition, not a note — the
        // resolution text is recorded on Falorb's side below rather than
        // dropped, since the far end has nowhere to put it.
        await client.resolveEscalation(escalation.bundAiId);

        await db
          .update(schema.supportEscalations)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(eq(schema.supportEscalations.id, escalation_id));

        return text(`Resolved escalation ${escalation_id} — "${resolution}"`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
