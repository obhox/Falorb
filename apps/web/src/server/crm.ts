import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * The CRM, read-side — two sources:
 *
 *   `crmContacts`/`crmLists`/`crmWorkflows`/`crmSignalRules` are the Linki
 *   mirror, written by `apps/worker/src/jobs/linki-sync.ts`.
 *
 *   `crmProfiles`/`crmDealStages`/`crmDeals` are Falorb-owned (Part 1a of
 *   the integration plan) — nothing writes these but the actions in
 *   `apps/web/src/server/actions/crm.ts`.
 */

export type CrmContactRow = typeof schema.crmContacts.$inferSelect;
export type CrmWorkflowRow = typeof schema.crmWorkflows.$inferSelect;
export type CrmSignalRuleRow = typeof schema.crmSignalRules.$inferSelect;

export async function listContacts(organizationId: string): Promise<CrmContactRow[]> {
  return db()
    .select()
    .from(schema.crmContacts)
    .where(eq(schema.crmContacts.organizationId, organizationId))
    .orderBy(desc(schema.crmContacts.syncedAt))
    .limit(500);
}

/** Linki targets nobody's brought into Falorb's CRM yet — the entry point for the pre-existing contact backlog. */
export async function listUnmatchedContacts(organizationId: string): Promise<CrmContactRow[]> {
  return db()
    .select()
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.organizationId, organizationId), isNull(schema.crmContacts.personId)))
    .orderBy(desc(schema.crmContacts.syncedAt))
    .limit(500);
}

export async function listWorkflows(organizationId: string): Promise<CrmWorkflowRow[]> {
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
