import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";
import { persons } from "./persons";

/**
 * A read-only mirror of Bund AI (customer support) data, pulled by
 * `apps/worker/src/jobs/bund-ai-sync.ts` — see the integration plan
 * (`/Users/obhox/.claude/plans/modular-gathering-cocoa.md`, Part 2).
 *
 * Same conventions as `crm.ts`: `organizationId` + `bundAiId` unique
 * together, `syncedAt` per row. `personId` is the support↔analytics join
 * point, resolved via `externalUserRef`/email — never inferred silently.
 *
 * Unlike Linki, Bund AI can push (its automations engine supports
 * `send_webhook`), but that push carries no signature, so it is treated only
 * as a low-latency nudge to re-sync a specific record — the poll in
 * `bund-ai-sync.ts` remains the sole writer.
 */

const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const supportBusinesses = pgTable(
  "support_businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    bundAiId: text("bund_ai_id").notNull(),
    name: text("name"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("support_businesses_org_bund_ai_uq").on(t.organizationId, t.bundAiId)],
);

export const supportConversations = pgTable(
  "support_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    bundAiId: text("bund_ai_id").notNull(),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
    channel: text("channel"),
    externalUserRef: text("external_user_ref"),
    status: text("status"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("support_conversations_org_bund_ai_uq").on(t.organizationId, t.bundAiId),
    index("support_conversations_person_idx").on(t.personId),
  ],
);

export const supportEscalations = pgTable(
  "support_escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    bundAiId: text("bund_ai_id").notNull(),
    conversationBundAiId: text("conversation_bund_ai_id"),
    conversationId: uuid("conversation_id").references(() => supportConversations.id, {
      onDelete: "set null",
    }),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
    reason: text("reason"),
    summary: text("summary"),
    status: text("status"),
    customerContact: text("customer_contact"),
    bundAiCreatedAt: timestamp("bund_ai_created_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("support_escalations_org_bund_ai_uq").on(t.organizationId, t.bundAiId),
    index("support_escalations_org_status_idx").on(t.organizationId, t.status),
    index("support_escalations_person_idx").on(t.personId),
  ],
);

export const supportLeads = pgTable(
  "support_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    bundAiId: text("bund_ai_id").notNull(),
    conversationBundAiId: text("conversation_bund_ai_id"),
    conversationId: uuid("conversation_id").references(() => supportConversations.id, {
      onDelete: "set null",
    }),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    intent: text("intent"),
    notes: text("notes"),
    status: text("status"),
    bundAiCreatedAt: timestamp("bund_ai_created_at", { withTimezone: true }),
    bundAiUpdatedAt: timestamp("bund_ai_updated_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("support_leads_org_bund_ai_uq").on(t.organizationId, t.bundAiId),
    index("support_leads_org_email_idx").on(t.organizationId, t.email),
    index("support_leads_person_idx").on(t.personId),
  ],
);

/** `transcript` is deliberately not mirrored — Bund AI's own API omits it from the list response, and full chat content would bloat every sync for no use this UI has yet. */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    bundAiId: text("bund_ai_id").notNull(),
    conversationBundAiId: text("conversation_bund_ai_id"),
    conversationId: uuid("conversation_id").references(() => supportConversations.id, {
      onDelete: "set null",
    }),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
    subject: text("subject"),
    description: text("description"),
    category: text("category"),
    priority: text("priority"),
    status: text("status"),
    customerName: text("customer_name"),
    customerContact: text("customer_contact"),
    createdBy: text("created_by"),
    bundAiCreatedAt: timestamp("bund_ai_created_at", { withTimezone: true }),
    bundAiUpdatedAt: timestamp("bund_ai_updated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("support_tickets_org_bund_ai_uq").on(t.organizationId, t.bundAiId),
    index("support_tickets_org_status_idx").on(t.organizationId, t.status),
    index("support_tickets_person_idx").on(t.personId),
  ],
);

/**
 * Raw payload from Bund AI's `send_webhook` automation action. Unsigned, so
 * never trusted as data on its own — `bund-ai-sync.ts` treats a row here only
 * as a hint to re-poll the named entity sooner, and the poll is what actually
 * writes to the tables above.
 */
export const supportInboundEvents = pgTable(
  "support_inbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_inbound_events_org_processed_idx").on(t.organizationId, t.processedAt)],
);
