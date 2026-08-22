import "server-only";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { markSyncRequested } from "./sync-demand";

/**
 * The CRM, read-side — two sources:
 *
 *   `crmContacts`/`crmLists`/`crmWorkflows`/`crmSignalRules` are the Linki
 *   mirror, written by `apps/worker/src/jobs/linki-sync.ts`. Every function
 *   that reads one of those tables flags the org for a fresh sync first (see
 *   `sync-demand.ts`) — the sync happens on the worker's next tick, not
 *   before the read returns.
 *
 *   `crmProfiles`/`crmDealStages`/`crmDeals` are Falorb-owned (Part 1a of
 *   the integration plan) — nothing writes these but the actions in
 *   `apps/web/src/server/actions/crm.ts`, so those reads don't flag Linki.
 */

export type CrmContactRow = typeof schema.crmContacts.$inferSelect;
export type CrmWorkflowRow = typeof schema.crmWorkflows.$inferSelect;
export type CrmSignalRuleRow = typeof schema.crmSignalRules.$inferSelect;

export async function listContacts(organizationId: string): Promise<CrmContactRow[]> {
  await markSyncRequested(organizationId, "linki");
  return db()
    .select()
    .from(schema.crmContacts)
    .where(eq(schema.crmContacts.organizationId, organizationId))
    .orderBy(desc(schema.crmContacts.syncedAt))
    .limit(500);
}

/** Linki targets nobody's brought into Falorb's CRM yet — the entry point for the pre-existing contact backlog. */
export async function listUnmatchedContacts(organizationId: string): Promise<CrmContactRow[]> {
  await markSyncRequested(organizationId, "linki");
  return db()
    .select()
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.organizationId, organizationId), isNull(schema.crmContacts.personId)))
    .orderBy(desc(schema.crmContacts.syncedAt))
    .limit(500);
}

export interface CrmContactsQuery {
  organizationId: string;
  /** Matches name, email or company. */
  search?: string;
  /** "unmatched" restricts to contacts with no linked Falorb person — the pre-existing backlog. */
  filter?: "all" | "unmatched";
  limit?: number;
  offset?: number;
}

export interface CrmContactsPage {
  rows: CrmContactRow[];
  hasMore: boolean;
  total: number;
}

/** The full, paginated Linki contacts mirror — unlike `listUnmatchedContacts`, not capped at 500. */
export async function listContactsPaginated(query: CrmContactsQuery): Promise<CrmContactsPage> {
  await markSyncRequested(query.organizationId, "linki");
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const conditions = [eq(schema.crmContacts.organizationId, query.organizationId)];

  if (query.filter === "unmatched") {
    conditions.push(isNull(schema.crmContacts.personId));
  }

  const term = query.search?.trim();
  if (term) {
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(schema.crmContacts.fullName, pattern),
        ilike(schema.crmContacts.email, pattern),
        ilike(schema.crmContacts.company, pattern),
      )!,
    );
  }

  const where = and(...conditions);
  const database = db();

  const [rows, countedRows] = await Promise.all([
    database
      .select()
      .from(schema.crmContacts)
      .where(where)
      .orderBy(desc(schema.crmContacts.syncedAt))
      .limit(limit + 1)
      .offset(offset),
    database.select({ total: sql<number>`count(*)::int` }).from(schema.crmContacts).where(where),
  ]);

  return {
    rows: rows.slice(0, limit),
    hasMore: rows.length > limit,
    total: countedRows[0]?.total ?? 0,
  };
}

export async function getContact(organizationId: string, contactId: string): Promise<CrmContactRow | null> {
  await markSyncRequested(organizationId, "linki");
  const [row] = await db()
    .select()
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface CrmContactListMembershipView {
  listId: string;
  listName: string;
}

export async function listMembershipsForContact(
  organizationId: string,
  contactId: string,
): Promise<CrmContactListMembershipView[]> {
  await markSyncRequested(organizationId, "linki");
  const rows = await db()
    .select({ listId: schema.crmLists.id, listName: schema.crmLists.name })
    .from(schema.crmListMembers)
    .innerJoin(schema.crmLists, eq(schema.crmLists.id, schema.crmListMembers.listId))
    .where(
      and(eq(schema.crmListMembers.organizationId, organizationId), eq(schema.crmListMembers.contactId, contactId)),
    )
    .orderBy(desc(schema.crmLists.linkiCreatedAt));
  return rows;
}

export async function listWorkflows(organizationId: string): Promise<CrmWorkflowRow[]> {
  await markSyncRequested(organizationId, "linki");
  return db()
    .select()
    .from(schema.crmWorkflows)
    .where(eq(schema.crmWorkflows.organizationId, organizationId))
    .orderBy(desc(schema.crmWorkflows.linkiCreatedAt));
}

export interface CrmListView {
  id: string;
  name: string;
  purpose: string | null;
  memberCount: number;
}

export async function listLists(organizationId: string): Promise<CrmListView[]> {
  await markSyncRequested(organizationId, "linki");
  const rows = await db()
    .select({
      id: schema.crmLists.id,
      name: schema.crmLists.name,
      purpose: schema.crmLists.purpose,
      memberCount: sql<number>`count(${schema.crmListMembers.id})`.mapWith(Number),
    })
    .from(schema.crmLists)
    .leftJoin(schema.crmListMembers, eq(schema.crmListMembers.listId, schema.crmLists.id))
    .where(eq(schema.crmLists.organizationId, organizationId))
    .groupBy(schema.crmLists.id)
    .orderBy(desc(schema.crmLists.linkiCreatedAt));
  return rows;
}

export async function listSignalRules(organizationId: string): Promise<CrmSignalRuleRow[]> {
  await markSyncRequested(organizationId, "linki");
  return db()
    .select()
    .from(schema.crmSignalRules)
    .where(eq(schema.crmSignalRules.organizationId, organizationId))
    .orderBy(desc(schema.crmSignalRules.minScore));
}

// --- Falorb-owned CRM (Part 1a) --------------------------------------------

export interface CrmProfileView {
  id: string;
  personId: string;
  personName: string | null;
  personEmail: string | null;
  title: string | null;
  phone: string | null;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  linkedToLinki: boolean;
  updatedAt: string;
}

export async function listCrmProfiles(organizationId: string): Promise<CrmProfileView[]> {
  const rows = await db()
    .select({
      id: schema.crmProfiles.id,
      personId: schema.crmProfiles.personId,
      personName: schema.persons.name,
      personEmail: schema.persons.email,
      title: schema.crmProfiles.title,
      phone: schema.crmProfiles.phone,
      status: schema.crmProfiles.status,
      ownerId: schema.crmProfiles.ownerId,
      ownerName: schema.user.name,
      linkiContactId: schema.crmContacts.id,
      updatedAt: schema.crmProfiles.updatedAt,
    })
    .from(schema.crmProfiles)
    .innerJoin(schema.persons, eq(schema.crmProfiles.personId, schema.persons.id))
    .leftJoin(schema.user, eq(schema.crmProfiles.ownerId, schema.user.id))
    .leftJoin(
      schema.crmContacts,
      and(
        eq(schema.crmContacts.personId, schema.crmProfiles.personId),
        eq(schema.crmContacts.organizationId, organizationId),
      ),
    )
    .where(eq(schema.crmProfiles.organizationId, organizationId))
    .orderBy(desc(schema.crmProfiles.updatedAt))
    .limit(500);

  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: r.personName,
    personEmail: r.personEmail,
    title: r.title,
    phone: r.phone,
    status: r.status,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    linkedToLinki: r.linkiContactId !== null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type CrmProfileRow = typeof schema.crmProfiles.$inferSelect;

export async function getCrmProfile(organizationId: string, personId: string): Promise<CrmProfileRow | null> {
  const [row] = await db()
    .select()
    .from(schema.crmProfiles)
    .where(and(eq(schema.crmProfiles.organizationId, organizationId), eq(schema.crmProfiles.personId, personId)))
    .limit(1);
  return row ?? null;
}

const DEFAULT_DEAL_STAGES = [
  { name: "New", position: 0, probability: 10 },
  { name: "Qualified", position: 1, probability: 30 },
  { name: "Meeting", position: 2, probability: 50 },
  { name: "Proposal", position: 3, probability: 75 },
  { name: "Won", position: 4, probability: 100, isWon: true },
  { name: "Lost", position: 5, probability: 0, isLost: true },
] as const;

export type CrmDealStageRow = typeof schema.crmDealStages.$inferSelect;

/** Lazy, idempotent per-org seed — there's no org-creation hook to attach this to, so it runs on first read/write instead. */
export async function ensureDealStages(organizationId: string): Promise<CrmDealStageRow[]> {
  const existing = await db()
    .select()
    .from(schema.crmDealStages)
    .where(eq(schema.crmDealStages.organizationId, organizationId))
    .orderBy(schema.crmDealStages.position);
  if (existing.length) return existing;

  await db()
    .insert(schema.crmDealStages)
    .values(DEFAULT_DEAL_STAGES.map((s) => ({ organizationId, ...s })))
    .onConflictDoNothing();

  return db()
    .select()
    .from(schema.crmDealStages)
    .where(eq(schema.crmDealStages.organizationId, organizationId))
    .orderBy(schema.crmDealStages.position);
}

export interface CrmDealView {
  id: string;
  name: string;
  personId: string | null;
  personName: string | null;
  stageId: string | null;
  stageName: string | null;
  isWon: boolean | null;
  isLost: boolean | null;
  amount: string | null;
  currency: string | null;
  ownerName: string | null;
  updatedAt: string;
}

export async function listDeals(organizationId: string): Promise<CrmDealView[]> {
  const rows = await db()
    .select({
      id: schema.crmDeals.id,
      name: schema.crmDeals.name,
      personId: schema.crmDeals.personId,
      personName: schema.persons.name,
      stageId: schema.crmDeals.stageId,
      stageName: schema.crmDealStages.name,
      isWon: schema.crmDealStages.isWon,
      isLost: schema.crmDealStages.isLost,
      amount: schema.crmDeals.amount,
      currency: schema.crmDeals.currency,
      ownerName: schema.user.name,
      updatedAt: schema.crmDeals.updatedAt,
    })
    .from(schema.crmDeals)
    .leftJoin(schema.persons, eq(schema.crmDeals.personId, schema.persons.id))
    .leftJoin(schema.crmDealStages, eq(schema.crmDeals.stageId, schema.crmDealStages.id))
    .leftJoin(schema.user, eq(schema.crmDeals.ownerId, schema.user.id))
    .where(eq(schema.crmDeals.organizationId, organizationId))
    .orderBy(desc(schema.crmDeals.updatedAt))
    .limit(500);

  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export interface CrmDealDetailView {
  id: string;
  name: string;
  personId: string | null;
  personName: string | null;
  personEmail: string | null;
  stageId: string | null;
  stageName: string | null;
  isWon: boolean | null;
  isLost: boolean | null;
  amount: string | null;
  currency: string | null;
  source: string | null;
  notes: string | null;
  expectedCloseDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export async function getDeal(organizationId: string, dealId: string): Promise<CrmDealDetailView | null> {
  const [row] = await db()
    .select({
      id: schema.crmDeals.id,
      name: schema.crmDeals.name,
      personId: schema.crmDeals.personId,
      personName: schema.persons.name,
      personEmail: schema.persons.email,
      stageId: schema.crmDeals.stageId,
      stageName: schema.crmDealStages.name,
      isWon: schema.crmDealStages.isWon,
      isLost: schema.crmDealStages.isLost,
      amount: schema.crmDeals.amount,
      currency: schema.crmDeals.currency,
      source: schema.crmDeals.source,
      notes: schema.crmDeals.notes,
      expectedCloseDate: schema.crmDeals.expectedCloseDate,
      ownerId: schema.crmDeals.ownerId,
      ownerName: schema.user.name,
      createdAt: schema.crmDeals.createdAt,
      updatedAt: schema.crmDeals.updatedAt,
      closedAt: schema.crmDeals.closedAt,
    })
    .from(schema.crmDeals)
    .leftJoin(schema.persons, eq(schema.crmDeals.personId, schema.persons.id))
    .leftJoin(schema.crmDealStages, eq(schema.crmDeals.stageId, schema.crmDealStages.id))
    .leftJoin(schema.user, eq(schema.crmDeals.ownerId, schema.user.id))
    .where(and(eq(schema.crmDeals.id, dealId), eq(schema.crmDeals.organizationId, organizationId)))
    .limit(1);

  if (!row) return null;
  return {
    ...row,
    expectedCloseDate: row.expectedCloseDate?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

// --- Runs (Linki mirror) ----------------------------------------------------

export interface CrmRunView {
  id: string;
  status: string | null;
  workflowName: string | null;
  listName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  syncedAt: string;
  trackCount: number;
}

export async function listRuns(organizationId: string): Promise<CrmRunView[]> {
  await markSyncRequested(organizationId, "linki");
  const rows = await db()
    .select({
      id: schema.crmRuns.id,
      status: schema.crmRuns.status,
      workflowName: schema.crmWorkflows.name,
      listName: schema.crmLists.name,
      startedAt: schema.crmRuns.startedAt,
      completedAt: schema.crmRuns.completedAt,
      syncedAt: schema.crmRuns.syncedAt,
      trackCount: sql<number>`count(${schema.crmRunProfileTracks.id})`.mapWith(Number),
    })
    .from(schema.crmRuns)
    .leftJoin(schema.crmWorkflows, eq(schema.crmWorkflows.id, schema.crmRuns.workflowId))
    .leftJoin(schema.crmLists, eq(schema.crmLists.id, schema.crmRuns.listId))
    .leftJoin(schema.crmRunProfileTracks, eq(schema.crmRunProfileTracks.runId, schema.crmRuns.id))
    .where(eq(schema.crmRuns.organizationId, organizationId))
    .groupBy(schema.crmRuns.id, schema.crmWorkflows.name, schema.crmLists.name)
    .orderBy(desc(schema.crmRuns.startedAt))
    .limit(500);

  return rows.map((r) => ({
    ...r,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    syncedAt: r.syncedAt.toISOString(),
  }));
}

export interface CrmRunTrackView {
  id: string;
  contactId: string | null;
  contactName: string | null;
  targetLinkiId: string;
  track: string | null;
  state: string | null;
  currentStep: number | null;
  lastStepAt: string | null;
  nextStepAt: string | null;
  errorMessage: string | null;
}

export interface CrmRunDetail {
  run: CrmRunView;
  tracks: CrmRunTrackView[];
}

export async function getRunDetail(organizationId: string, runId: string): Promise<CrmRunDetail | null> {
  await markSyncRequested(organizationId, "linki");
  const [run] = await db()
    .select({
      id: schema.crmRuns.id,
      status: schema.crmRuns.status,
      workflowName: schema.crmWorkflows.name,
      listName: schema.crmLists.name,
      startedAt: schema.crmRuns.startedAt,
      completedAt: schema.crmRuns.completedAt,
      syncedAt: schema.crmRuns.syncedAt,
    })
    .from(schema.crmRuns)
    .leftJoin(schema.crmWorkflows, eq(schema.crmWorkflows.id, schema.crmRuns.workflowId))
    .leftJoin(schema.crmLists, eq(schema.crmLists.id, schema.crmRuns.listId))
    .where(and(eq(schema.crmRuns.id, runId), eq(schema.crmRuns.organizationId, organizationId)))
    .limit(1);
  if (!run) return null;

  const tracks = await db()
    .select({
      id: schema.crmRunProfileTracks.id,
      contactId: schema.crmRunProfileTracks.contactId,
      contactName: schema.crmContacts.fullName,
      targetLinkiId: schema.crmRunProfileTracks.targetLinkiId,
      track: schema.crmRunProfileTracks.track,
      state: schema.crmRunProfileTracks.state,
      currentStep: schema.crmRunProfileTracks.currentStep,
      lastStepAt: schema.crmRunProfileTracks.lastStepAt,
      nextStepAt: schema.crmRunProfileTracks.nextStepAt,
      errorMessage: schema.crmRunProfileTracks.errorMessage,
    })
    .from(schema.crmRunProfileTracks)
    .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.crmRunProfileTracks.contactId))
    .where(
      and(
        eq(schema.crmRunProfileTracks.runId, runId),
        eq(schema.crmRunProfileTracks.organizationId, organizationId),
      ),
    )
    .orderBy(desc(schema.crmRunProfileTracks.lastStepAt));

  return {
    run: {
      ...run,
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      syncedAt: run.syncedAt.toISOString(),
      trackCount: tracks.length,
    },
    tracks: tracks.map((t) => ({
      ...t,
      lastStepAt: t.lastStepAt?.toISOString() ?? null,
      nextStepAt: t.nextStepAt?.toISOString() ?? null,
    })),
  };
}

// --- Sent messages + suppressions (Linki mirror, read-only) -----------------

export interface CrmSentMessageView {
  id: string;
  recipient: string | null;
  subject: string | null;
  status: string | null;
  contactId: string | null;
  contactName: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
  syncedAt: string;
}

export async function listSentMessages(organizationId: string): Promise<CrmSentMessageView[]> {
  await markSyncRequested(organizationId, "linki");
  const rows = await db()
    .select({
      id: schema.crmSentMessages.id,
      recipient: schema.crmSentMessages.recipient,
      subject: schema.crmSentMessages.subject,
      status: schema.crmSentMessages.status,
      contactId: schema.crmSentMessages.contactId,
      contactName: schema.crmContacts.fullName,
      acceptedAt: schema.crmSentMessages.acceptedAt,
      deliveredAt: schema.crmSentMessages.deliveredAt,
      bouncedAt: schema.crmSentMessages.bouncedAt,
      complainedAt: schema.crmSentMessages.complainedAt,
      syncedAt: schema.crmSentMessages.syncedAt,
    })
    .from(schema.crmSentMessages)
    .leftJoin(schema.crmContacts, eq(schema.crmContacts.id, schema.crmSentMessages.contactId))
    .where(eq(schema.crmSentMessages.organizationId, organizationId))
    .orderBy(desc(schema.crmSentMessages.syncedAt))
    .limit(500);

  return rows.map((r) => ({
    ...r,
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    bouncedAt: r.bouncedAt?.toISOString() ?? null,
    complainedAt: r.complainedAt?.toISOString() ?? null,
    syncedAt: r.syncedAt.toISOString(),
  }));
}

export interface CrmSuppressionView {
  id: string;
  kind: string;
  value: string;
  reason: string | null;
  syncedAt: string;
}

export async function listSuppressions(organizationId: string): Promise<CrmSuppressionView[]> {
  await markSyncRequested(organizationId, "linki");
  const rows = await db()
    .select({
      id: schema.crmSuppressions.id,
      kind: schema.crmSuppressions.kind,
      value: schema.crmSuppressions.value,
      reason: schema.crmSuppressions.reason,
      syncedAt: schema.crmSuppressions.syncedAt,
    })
    .from(schema.crmSuppressions)
    .where(eq(schema.crmSuppressions.organizationId, organizationId))
    .orderBy(desc(schema.crmSuppressions.syncedAt))
    .limit(500);

  return rows.map((r) => ({ ...r, syncedAt: r.syncedAt.toISOString() }));
}

/**
 * Linki's synced emails and campaign enrollment for one person — the mirror
 * (`crmSentMessages`, `crmRunProfiles`/`crmRuns`) has existed since Phase L3
 * but nothing rendered it. Joined through `crmContacts.personId`, which is
 * the same email-match backfill (`linkContactsToPersons` in
 * `linki-sync.ts`) that links a manually-added contact (`createCrmContact`
 * in `actions/crm.ts`) to Linki's data, not just an auto-synced one — the
 * join here doesn't care which path attached the person.
 */
export interface LinkiEmailView {
  id: string;
  recipient: string | null;
  subject: string | null;
  status: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
}

export async function listSentMessagesForPerson(
  organizationId: string,
  personId: string,
): Promise<LinkiEmailView[]> {
  await markSyncRequested(organizationId, "linki");
  const rows = await db()
    .select({
      id: schema.crmSentMessages.id,
      recipient: schema.crmSentMessages.recipient,
      subject: schema.crmSentMessages.subject,
      status: schema.crmSentMessages.status,
      acceptedAt: schema.crmSentMessages.acceptedAt,
      deliveredAt: schema.crmSentMessages.deliveredAt,
      bouncedAt: schema.crmSentMessages.bouncedAt,
    })
    .from(schema.crmSentMessages)
    .innerJoin(schema.crmContacts, eq(schema.crmSentMessages.contactId, schema.crmContacts.id))
    .where(and(eq(schema.crmContacts.organizationId, organizationId), eq(schema.crmContacts.personId, personId)))
    .orderBy(desc(schema.crmSentMessages.acceptedAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    recipient: r.recipient,
    subject: r.subject,
    status: r.status,
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    bouncedAt: r.bouncedAt?.toISOString() ?? null,
  }));
}

export interface LinkiCampaignRunView {
  runId: string;
  workflowName: string | null;
  status: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export async function listCampaignRunsForPerson(
  organizationId: string,
  personId: string,
): Promise<LinkiCampaignRunView[]> {
  await markSyncRequested(organizationId, "linki");
  const rows = await db()
    .select({
      runId: schema.crmRuns.id,
      workflowName: schema.crmWorkflows.name,
      status: schema.crmRuns.status,
      startedAt: schema.crmRuns.startedAt,
      completedAt: schema.crmRuns.completedAt,
    })
    .from(schema.crmRunProfiles)
    .innerJoin(schema.crmContacts, eq(schema.crmRunProfiles.contactId, schema.crmContacts.id))
    .innerJoin(schema.crmRuns, eq(schema.crmRunProfiles.runId, schema.crmRuns.id))
    .leftJoin(schema.crmWorkflows, eq(schema.crmRuns.workflowId, schema.crmWorkflows.id))
    .where(and(eq(schema.crmContacts.organizationId, organizationId), eq(schema.crmContacts.personId, personId)))
    .orderBy(desc(schema.crmRuns.startedAt))
    .limit(25);

  return rows.map((r) => ({
    ...r,
    startedAt: r.startedAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
  }));
}

export async function listDealsForPerson(organizationId: string, personId: string): Promise<CrmDealView[]> {
  const rows = await db()
    .select({
      id: schema.crmDeals.id,
      name: schema.crmDeals.name,
      personId: schema.crmDeals.personId,
      personName: schema.persons.name,
      stageId: schema.crmDeals.stageId,
      stageName: schema.crmDealStages.name,
      isWon: schema.crmDealStages.isWon,
      isLost: schema.crmDealStages.isLost,
      amount: schema.crmDeals.amount,
      currency: schema.crmDeals.currency,
      ownerName: schema.user.name,
      updatedAt: schema.crmDeals.updatedAt,
    })
    .from(schema.crmDeals)
    .leftJoin(schema.persons, eq(schema.crmDeals.personId, schema.persons.id))
    .leftJoin(schema.crmDealStages, eq(schema.crmDeals.stageId, schema.crmDealStages.id))
    .leftJoin(schema.user, eq(schema.crmDeals.ownerId, schema.user.id))
    .where(and(eq(schema.crmDeals.organizationId, organizationId), eq(schema.crmDeals.personId, personId)))
    .orderBy(desc(schema.crmDeals.updatedAt));

  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

export interface LinkedContactView {
  linkiId: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  syncedAt: string;
}

/**
 * The Linki contact a person is linked to, if any.
 *
 * These two live here rather than in `actions/crm.ts`, and the distinction is
 * a security boundary rather than a filing preference. Next exposes **every**
 * export of a `"use server"` module as a callable endpoint, so a function
 * there that takes an `organizationId` and does not re-derive it from the
 * session is a cross-tenant read anyone able to post to the action id can
 * perform — for this one, another organization's contact name, email address
 * and employer. They were only ever called from server components, which
 * already hold a session, so the fix is to stop exposing them rather than to
 * guard them: this module is `server-only`, which means it can be imported by
 * a server component and cannot become an endpoint.
 *
 * The rule the dashboard follows: a `"use server"` export either derives its
 * tenancy from `requireSession()`, or it does not belong in a `"use server"`
 * file.
 */
export async function getLinkedContact(
  organizationId: string,
  personId: string,
): Promise<LinkedContactView | null> {
  await markSyncRequested(organizationId, "linki");
  const [row] = await db()
    .select()
    .from(schema.crmContacts)
    .where(
      and(
        eq(schema.crmContacts.organizationId, organizationId),
        eq(schema.crmContacts.personId, personId),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    linkiId: row.linkiId,
    fullName: row.fullName,
    email: row.email,
    company: row.company,
    syncedAt: row.syncedAt.toISOString(),
  };
}

/**
 * Whether this organization has Linki connected at the org level.
 *
 * Org-level connection only — a property-only override doesn't light up this
 * org-wide check; see `packages/db/src/schema/integrations.ts`.
 */
export async function isLinkiConnected(organizationId: string): Promise<boolean> {
  await markSyncRequested(organizationId, "linki");
  const [row] = await db()
    .select({ id: schema.integrationConnections.id })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "linki"),
        eq(schema.integrationConnections.status, "active"),
        isNull(schema.integrationConnections.revokedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
