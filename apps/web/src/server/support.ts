import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { markSyncRequested } from "./sync-demand";

/**
 * The Bund AI support mirror, read-side. Written by
 * `apps/worker/src/jobs/bund-ai-sync.ts`; this file only reads it. A read
 * also flags the org for a fresh sync (see `sync-demand.ts`) — that sync
 * happens on the worker's next tick, not before this read returns.
 */

export type SupportEscalationRow = typeof schema.supportEscalations.$inferSelect;
export type SupportConversationRow = typeof schema.supportConversations.$inferSelect;
export type SupportLeadRow = typeof schema.supportLeads.$inferSelect;
export type SupportTicketRow = typeof schema.supportTickets.$inferSelect;

export async function listEscalations(organizationId: string): Promise<SupportEscalationRow[]> {
  await markSyncRequested(organizationId, "bund_ai");
  return db()
    .select()
    .from(schema.supportEscalations)
    .where(eq(schema.supportEscalations.organizationId, organizationId))
    .orderBy(desc(schema.supportEscalations.bundAiCreatedAt))
    .limit(200);
}

export async function listConversations(organizationId: string): Promise<SupportConversationRow[]> {
  await markSyncRequested(organizationId, "bund_ai");
  return db()
    .select()
    .from(schema.supportConversations)
    .where(eq(schema.supportConversations.organizationId, organizationId))
    .orderBy(desc(schema.supportConversations.lastActivityAt))
    .limit(200);
}

export async function listLeads(organizationId: string): Promise<SupportLeadRow[]> {
  await markSyncRequested(organizationId, "bund_ai");
  return db()
    .select()
    .from(schema.supportLeads)
    .where(eq(schema.supportLeads.organizationId, organizationId))
    .orderBy(desc(schema.supportLeads.bundAiUpdatedAt))
    .limit(200);
}

export async function listTickets(organizationId: string): Promise<SupportTicketRow[]> {
  await markSyncRequested(organizationId, "bund_ai");
  return db()
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.organizationId, organizationId))
    .orderBy(desc(schema.supportTickets.bundAiUpdatedAt))
    .limit(200);
}

export async function getEscalation(organizationId: string, id: string): Promise<SupportEscalationRow | null> {
  await markSyncRequested(organizationId, "bund_ai");
  const [row] = await db()
    .select()
    .from(schema.supportEscalations)
    .where(and(eq(schema.supportEscalations.id, id), eq(schema.supportEscalations.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getConversation(organizationId: string, id: string): Promise<SupportConversationRow | null> {
  await markSyncRequested(organizationId, "bund_ai");
  const [row] = await db()
    .select()
    .from(schema.supportConversations)
    .where(and(eq(schema.supportConversations.id, id), eq(schema.supportConversations.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getLead(organizationId: string, id: string): Promise<SupportLeadRow | null> {
  await markSyncRequested(organizationId, "bund_ai");
  const [row] = await db()
    .select()
    .from(schema.supportLeads)
    .where(and(eq(schema.supportLeads.id, id), eq(schema.supportLeads.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getTicket(organizationId: string, id: string): Promise<SupportTicketRow | null> {
  await markSyncRequested(organizationId, "bund_ai");
  const [row] = await db()
    .select()
    .from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.id, id), eq(schema.supportTickets.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface ConversationActivity {
  escalations: { id: string; reason: string | null; status: string | null }[];
  leads: { id: string; name: string | null; status: string | null }[];
  tickets: { id: string; subject: string | null; status: string | null }[];
}

/** What a conversation escalated into — leads/tickets/escalations all carry `conversationId` back to their originating chat. */
export async function listConversationActivity(
  organizationId: string,
  conversationId: string,
): Promise<ConversationActivity> {
  await markSyncRequested(organizationId, "bund_ai");
  const [escalations, leads, tickets] = await Promise.all([
    db()
      .select({ id: schema.supportEscalations.id, reason: schema.supportEscalations.reason, status: schema.supportEscalations.status })
      .from(schema.supportEscalations)
      .where(
        and(
          eq(schema.supportEscalations.organizationId, organizationId),
          eq(schema.supportEscalations.conversationId, conversationId),
        ),
      ),
    db()
      .select({ id: schema.supportLeads.id, name: schema.supportLeads.name, status: schema.supportLeads.status })
      .from(schema.supportLeads)
      .where(
        and(eq(schema.supportLeads.organizationId, organizationId), eq(schema.supportLeads.conversationId, conversationId)),
      ),
    db()
      .select({ id: schema.supportTickets.id, subject: schema.supportTickets.subject, status: schema.supportTickets.status })
      .from(schema.supportTickets)
      .where(
        and(eq(schema.supportTickets.organizationId, organizationId), eq(schema.supportTickets.conversationId, conversationId)),
      ),
  ]);

  return { escalations, leads, tickets };
}

/** Org-level connection only — a property-only override doesn't light up this org-wide "Bund AI connected" check; see `packages/db/src/schema/integrations.ts`. */
export async function isBundAiConnected(organizationId: string): Promise<boolean> {
  await markSyncRequested(organizationId, "bund_ai");
  const [row] = await db()
    .select({ id: schema.integrationConnections.id })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "bund_ai"),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
