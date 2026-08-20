import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./tenancy";
import { persons } from "./persons";
import { user } from "./auth";

/**
 * Two kinds of table live here — see the integration plan
 * (`/Users/obhox/.claude/plans/modular-gathering-cocoa.md`, Part 1 / 1a).
 *
 * Most of this file is a read-only **mirror** of Linki (sales/outreach)
 * data, pulled by `apps/worker/src/jobs/linki-sync.ts`. Every mirror table
 * carries `organizationId` + `linkiId` (Linki's own id for the row), unique
 * together, so re-syncing is an upsert regardless of pagination order.
 * `syncedAt` is per-row so a stale mirror row is visible as such rather than
 * silently indistinguishable from a fresh one. Falorb never writes any of it
 * back to Linki except through the narrow, explicitly gated paths in
 * `linki-signal-push.ts` (Phase L5+).
 *
 * `crmProfiles`, `crmDealStages` and `crmDeals` are the exception: **Falorb
 * owns these natively** (Part 1a). They are not synced from anywhere — a
 * human creates and edits them in Falorb, and (for `crmProfiles`) that data
 * can be *pushed out* to Linki, the reverse direction of everything else in
 * this file.
 */

const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const crmContacts = pgTable(
  "crm_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    /** The CRM↔analytics join point — set once a match is found (email or explicit link), never inferred silently. */
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
    fullName: text("full_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    company: text("company"),
    companyLinkiId: text("company_linki_id"),
    location: text("location"),
    linkedinUrl: text("linkedin_url"),
    ownerLinkiId: text("owner_linki_id"),
    linkiCreatedAt: timestamp("linki_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_contacts_org_linki_uq").on(t.organizationId, t.linkiId),
    index("crm_contacts_org_email_idx").on(t.organizationId, t.email),
    index("crm_contacts_person_idx").on(t.personId),
  ],
);

export const crmLists = pgTable(
  "crm_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    purpose: text("purpose"),
    linkiCreatedAt: timestamp("linki_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crm_lists_org_linki_uq").on(t.organizationId, t.linkiId)],
);

/** (list, contact) membership pairs. Full contact data lives in `crmContacts`, so this stays lightweight. */
export const crmListMembers = pgTable(
  "crm_list_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    listLinkiId: text("list_linki_id").notNull(),
    targetLinkiId: text("target_linki_id").notNull(),
    listId: uuid("list_id").references(() => crmLists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "cascade" }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_list_members_org_pair_uq").on(t.organizationId, t.listLinkiId, t.targetLinkiId),
    index("crm_list_members_list_idx").on(t.listId),
  ],
);

export const crmWorkflows = pgTable(
  "crm_workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    linkiCreatedAt: timestamp("linki_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crm_workflows_org_linki_uq").on(t.organizationId, t.linkiId)],
);

export const crmRuns = pgTable(
  "crm_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    workflowLinkiId: text("workflow_linki_id"),
    listLinkiId: text("list_linki_id"),
    workflowId: uuid("workflow_id").references(() => crmWorkflows.id, { onDelete: "set null" }),
    listId: uuid("list_id").references(() => crmLists.id, { onDelete: "set null" }),
    status: text("status"),
    linkiCreatedAt: timestamp("linki_created_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crm_runs_org_linki_uq").on(t.organizationId, t.linkiId)],
);

/** Which targets are enrolled in a run. Per-channel progress is in `crmRunProfileTracks`. */
export const crmRunProfiles = pgTable(
  "crm_run_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    runLinkiId: text("run_linki_id").notNull(),
    targetLinkiId: text("target_linki_id").notNull(),
    runId: uuid("run_id").references(() => crmRuns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "cascade" }),
    linkiCreatedAt: timestamp("linki_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_run_profiles_org_linki_uq").on(t.organizationId, t.linkiId),
    index("crm_run_profiles_run_idx").on(t.runId),
  ],
);

/** Per-target, per-channel (linkedin/email) send/reply progress — the actual outreach state. */
export const crmRunProfileTracks = pgTable(
  "crm_run_profile_tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    runProfileLinkiId: text("run_profile_linki_id").notNull(),
    runLinkiId: text("run_linki_id").notNull(),
    targetLinkiId: text("target_linki_id").notNull(),
    runId: uuid("run_id").references(() => crmRuns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "cascade" }),
    track: text("track"),
    state: text("state"),
    currentStep: integer("current_step"),
    lastStepAt: timestamp("last_step_at", { withTimezone: true }),
    nextStepAt: timestamp("next_step_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_run_profile_tracks_org_linki_uq").on(t.organizationId, t.linkiId),
    index("crm_run_profile_tracks_run_idx").on(t.runId),
  ],
);

/**
 * The Falorb-owned CRM-contact extension — title/phone/LinkedIn/status/owner
 * for a person, entered or edited in Falorb rather than pulled from Linki.
 *
 * Created explicitly (an "Add to CRM" action), never automatically for every
 * visitor — most `persons` rows are anonymous traffic, not sales contacts.
 * This row is what marks the boundary between "someone we have analytics on"
 * and "someone in the CRM." One per person, hence the unique `personId`.
 *
 * `crmContacts` still exists and is unaffected by this table — it stays a
 * reconciliation layer (which Linki targets exist, which are email-matched
 * to a person), not the authoritative contact record. This table is that
 * record now.
 */
export const crmProfiles = pgTable(
  "crm_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    personId: uuid("person_id")
      .notNull()
      .unique()
      .references(() => persons.id, { onDelete: "cascade" }),
    title: text("title"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    /** "lead" | "prospect" | "customer" | "churned" — free text, not an enum: a status vocabulary is a business decision, not a schema one. */
    status: text("status").notNull().default("lead"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crm_profiles_org_idx").on(t.organizationId)],
);

/**
 * Falorb-native deal pipeline — replaces the old Linki-mirrored
 * `crmPipelineStages`. Seeded lazily per org (`ensureDealStages` in
 * `apps/web/src/server/crm.ts`) rather than synced from anywhere.
 */
export const crmDealStages = pgTable(
  "crm_deal_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    probability: integer("probability").notNull().default(0),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crm_deal_stages_org_name_uq").on(t.organizationId, t.name)],
);

/**
 * Falorb-native deals — replaces the old Linki-mirrored `crmOpportunities`.
 * References `persons` directly, not `crmProfiles`: matches how every other
 * person-linked table in this file already handles the relationship
 * (`set null`, tombstone-tolerant), and avoids forcing an FK lifecycle
 * decision `crmProfiles` has no protection story for yet. The "no deal
 * without a CRM profile" invariant is enforced in `createDeal` itself
 * (auto-provisions a profile in the same transaction), not by the schema.
 */
export const crmDeals = pgTable(
  "crm_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
    stageId: uuid("stage_id").references(() => crmDealStages.id, { onDelete: "set null" }),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    amount: numeric("amount"),
    currency: text("currency"),
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    source: text("source"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("crm_deals_org_idx").on(t.organizationId),
    index("crm_deals_person_idx").on(t.personId),
    index("crm_deals_stage_idx").on(t.stageId),
  ],
);

/**
 * Read-only mirror of Linki's signal-triggered campaign rules — shown in the
 * Falorb UI so an admin can see exactly which workflow a signal will hit, and
 * whether `autoStart` is on, before enabling a `signalMapping` (Phase L4/L5).
 * Falorb never writes to this table's Linki-side source; it is display-only.
 */
export const crmSignalRules = pgTable(
  "crm_signal_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    name: text("name").notNull(),
    signalType: text("signal_type").notNull(),
    minScore: numeric("min_score").notNull().default("0"),
    listLinkiId: text("list_linki_id"),
    workflowLinkiId: text("workflow_linki_id"),
    enabled: boolean("enabled").notNull().default(true),
    autoStart: boolean("auto_start").notNull().default(false),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crm_signal_rules_org_linki_uq").on(t.organizationId, t.linkiId)],
);

export const crmSuppressions = pgTable(
  "crm_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    reason: text("reason"),
    targetLinkiId: text("target_linki_id"),
    linkiCreatedAt: timestamp("linki_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_suppressions_org_linki_uq").on(t.organizationId, t.linkiId),
    index("crm_suppressions_org_value_idx").on(t.organizationId, t.value),
  ],
);

export const crmSentMessages = pgTable(
  "crm_sent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    linkiId: text("linki_id").notNull(),
    targetLinkiId: text("target_linki_id"),
    runLinkiId: text("run_linki_id"),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
    recipient: text("recipient"),
    subject: text("subject"),
    status: text("status"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("crm_sent_messages_org_linki_uq").on(t.organizationId, t.linkiId)],
);

/**
 * Per-org config: which Falorb signal source maps to which Linki signal type
 * (Phase L5). `enabled` defaults false — this is the mechanism Gate B gates,
 * not a live toggle by default.
 */
export const crmSignalMappings = pgTable(
  "crm_signal_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    name: text("name").notNull(),
    /** "lead_score" | "ai_signal" | "interest_score" */
    sourceKind: text("source_kind").notNull(),
    /** e.g. { minScore }, { aiSignalKind }, { interestKey, minScore } depending on sourceKind. */
    sourceConfig: jsonb("source_config").notNull().default({}),
    linkiSignalType: text("linki_signal_type").notNull(),
    linkiSource: text("linki_source").notNull().default("falorb"),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("crm_signal_mappings_org_idx").on(t.organizationId)],
);

/**
 * Audit + idempotency for every signal push attempt, dry-run or live —
 * Phase L5/L6. A person is recorded here before a live call is ever made, so
 * re-running the push job cannot double-push, and every push is reviewable
 * before Gate B is cleared.
 */
export const crmSignalPushes = pgTable(
  "crm_signal_pushes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    mappingId: uuid("mapping_id").references(() => crmSignalMappings.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
    signalType: text("signal_type").notNull(),
    score: numeric("score"),
    payload: jsonb("payload").notNull().default({}),
    /** "dry_run" | "sent" | "failed" | "skipped_unmatched" | "skipped_suppressed" */
    status: text("status").notNull(),
    linkiSignalId: text("linki_signal_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("crm_signal_pushes_org_idx").on(t.organizationId, t.createdAt),
    index("crm_signal_pushes_person_idx").on(t.personId),
  ],
);
