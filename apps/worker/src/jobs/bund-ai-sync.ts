import { and, eq, isNull, sql } from "drizzle-orm";
import { decryptCredential, schema } from "@falorb/db";
import {
  BundAiClient,
  type BundAiConversation,
  type BundAiEscalation,
  type BundAiLead,
  type BundAiTicket,
} from "@falorb/bund-ai-client";
import type { WorkerContext } from "../context";

/**
 * Mirrors Bund AI (customer support) data into Falorb's own Postgres, per
 * org — same shape as `linki-sync.ts`: full paginated poll, upsert on
 * `(organizationId, bundAiId)`, `lastSyncedAt` on `integrationConnections` as
 * the connection-health signal.
 *
 * Bund AI's automations engine *can* push (`send_webhook`), but that push
 * carries no request signature, so it is never trusted as data on its own —
 * see `supportInboundEvents` in `packages/db/src/schema/support.ts`. This
 * poll is the sole writer to the mirror tables; a received push (once the
 * inbound receiver exists) only makes the next poll happen sooner, it never
 * writes support data itself.
 */

const PAGE_SIZE = 200;

export async function syncBundAi(context: WorkerContext): Promise<void> {
  // Org-level connections only — same reasoning as `linki-sync.ts`: a
  // property's own override is used on demand, not mirrored by this job.
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "bund_ai"),
        eq(schema.integrationConnections.status, "active"),
      ),
    );

  for (const connection of connections) {
    try {
      await syncOrg(context, connection);
    } catch (error) {
      console.error(`[bund-ai-sync] org ${connection.organizationId} failed:`, String(error));
      await context.db
        .update(schema.integrationConnections)
        .set({ status: "error", lastError: String(error), updatedAt: new Date() })
        .where(eq(schema.integrationConnections.id, connection.id));
    }
  }
}

async function syncOrg(
  context: WorkerContext,
  connection: typeof schema.integrationConnections.$inferSelect,
): Promise<void> {
  const orgId = connection.organizationId;
  const apiKey = decryptCredential({
    ciphertext: connection.encryptedApiKey,
    iv: connection.iv,
    authTag: connection.authTag,
  });
  const client = new BundAiClient({ baseUrl: connection.baseUrl, apiKey });

  const conversations = await paginateAll((limit, offset) =>
    client.listConversations({ limit, offset }).then((p) => p.conversations),
  );
  await upsertConversations(context, orgId, conversations);
  await linkConversationsToPersons(context, orgId);

  const escalations = await paginateAll((limit, offset) =>
    client.listEscalations({ limit, offset }).then((p) => p.escalations),
  );
  await upsertEscalations(context, orgId, escalations);

  const leads = await paginateAll((limit, offset) =>
    client.listLeads({ limit, offset }).then((p) => p.leads),
  );
  await upsertLeads(context, orgId, leads);

  const tickets = await paginateAll((limit, offset) =>
    client.listTickets({ limit, offset }).then((p) => p.tickets),
  );
  await upsertTickets(context, orgId, tickets);

  await context.db
    .update(schema.integrationConnections)
    .set({ lastSyncedAt: new Date(), status: "active", lastError: null, updatedAt: new Date() })
    .where(eq(schema.integrationConnections.id, connection.id));

  console.log(
    `[bund-ai-sync] org ${orgId}: ${conversations.length} conversations, ${escalations.length} escalations, ${leads.length} leads, ${tickets.length} tickets`,
  );
}

async function paginateAll<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(PAGE_SIZE, offset);
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

async function upsertConversations(
  context: WorkerContext,
  orgId: string,
  rows: BundAiConversation[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.supportConversations)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        bundAiId: r.id,
        channel: r.channel,
        externalUserRef: r.externalUserRef,
        status: r.status,
        startedAt: toDate(r.startedAt),
        lastActivityAt: toDate(r.lastActivityAt),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.supportConversations.organizationId, schema.supportConversations.bundAiId],
      set: {
        status: sql`excluded.status`,
        lastActivityAt: sql`excluded.last_activity_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

/**
 * Best-effort: matches a conversation's `externalUserRef` against a person's
 * explicit `identifiedId` — the same deterministic-`identify()` signal Falorb
 * already requires for any cross-source identity join. This only works if the
 * tenant's widget integration calls `identify()` with the same value it hands
 * Bund AI as the visitor ref; where it doesn't, the conversation stays
 * unmatched rather than guessing.
 */
async function linkConversationsToPersons(context: WorkerContext, orgId: string): Promise<void> {
  await context.db.execute(sql`
    UPDATE support_conversations sc
    SET person_id = p.id
    FROM persons p
    WHERE sc.organization_id = ${orgId}
      AND p.organization_id = ${orgId}
      AND sc.person_id IS NULL
      AND sc.external_user_ref IS NOT NULL
      AND p.identified_id = sc.external_user_ref
  `);
}

async function upsertEscalations(
  context: WorkerContext,
  orgId: string,
  rows: BundAiEscalation[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.supportEscalations)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        bundAiId: r.id,
        conversationBundAiId: r.conversationId,
        reason: r.reason,
        summary: r.summary,
        status: r.status,
        customerContact: r.customerContact,
        bundAiCreatedAt: toDate(r.createdAt),
        resolvedAt: toDate(r.resolvedAt),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.supportEscalations.organizationId, schema.supportEscalations.bundAiId],
      set: {
        status: sql`excluded.status`,
        summary: sql`excluded.summary`,
        resolvedAt: sql`excluded.resolved_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await resolveViaConversation(context, orgId, "support_escalations");
}

async function upsertLeads(context: WorkerContext, orgId: string, rows: BundAiLead[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.supportLeads)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        bundAiId: r.id,
        conversationBundAiId: r.conversationId,
        name: r.name,
        email: r.email,
        phone: r.phone,
        intent: r.intent,
        notes: r.notes,
        status: r.status,
        bundAiCreatedAt: toDate(r.createdAt),
        bundAiUpdatedAt: toDate(r.updatedAt),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.supportLeads.organizationId, schema.supportLeads.bundAiId],
      set: {
        status: sql`excluded.status`,
        notes: sql`excluded.notes`,
        bundAiUpdatedAt: sql`excluded.bund_ai_updated_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await resolveViaConversation(context, orgId, "support_leads");
  // Leads carry their own email, which is often a stronger/earlier signal
  // than the conversation's externalUserRef — fills in anything the
  // conversation-based match above didn't catch.
  await context.db.execute(sql`
    UPDATE support_leads sl
    SET person_id = p.id
    FROM persons p
    WHERE sl.organization_id = ${orgId}
      AND p.organization_id = ${orgId}
      AND sl.person_id IS NULL
      AND sl.email IS NOT NULL
      AND p.email IS NOT NULL
      AND lower(sl.email) = lower(p.email)
  `);
}

async function upsertTickets(context: WorkerContext, orgId: string, rows: BundAiTicket[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.supportTickets)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        bundAiId: r.id,
        conversationBundAiId: r.conversationId,
        subject: r.subject,
        description: r.description,
        category: r.category,
        priority: r.priority,
        status: r.status,
        customerName: r.customerName,
        customerContact: r.customerContact,
        createdBy: r.createdBy,
        bundAiCreatedAt: toDate(r.createdAt),
        bundAiUpdatedAt: toDate(r.updatedAt),
        resolvedAt: toDate(r.resolvedAt),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.supportTickets.organizationId, schema.supportTickets.bundAiId],
      set: {
        status: sql`excluded.status`,
        priority: sql`excluded.priority`,
        bundAiUpdatedAt: sql`excluded.bund_ai_updated_at`,
        resolvedAt: sql`excluded.resolved_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await resolveViaConversation(context, orgId, "support_tickets");
}

/** Shared resolver: fills conversationId/personId for any table keyed by conversationBundAiId, via the already-linked conversation. */
async function resolveViaConversation(
  context: WorkerContext,
  orgId: string,
  table: "support_escalations" | "support_leads" | "support_tickets",
): Promise<void> {
  await context.db.execute(sql`
    UPDATE ${sql.identifier(table)} t SET conversation_id = sc.id
    FROM support_conversations sc
    WHERE t.organization_id = ${orgId} AND sc.organization_id = ${orgId}
      AND t.conversation_bund_ai_id = sc.bund_ai_id AND t.conversation_id IS NULL
  `);
  await context.db.execute(sql`
    UPDATE ${sql.identifier(table)} t SET person_id = sc.person_id
    FROM support_conversations sc
    WHERE t.organization_id = ${orgId} AND sc.organization_id = ${orgId}
      AND t.conversation_id = sc.id AND t.person_id IS NULL AND sc.person_id IS NOT NULL
  `);
}
