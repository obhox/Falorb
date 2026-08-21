import { and, eq, sql } from "drizzle-orm";
import { decryptCredential, schema } from "@falorb/db";
import {
  LinkiClient,
  type LinkiContact,
  type LinkiList,
  type LinkiListMember,
  type LinkiRun,
  type LinkiRunProfile,
  type LinkiRunProfileTrack,
  type LinkiSentMessage,
  type LinkiSignalRule,
  type LinkiSuppression,
  type LinkiWorkflow,
} from "@falorb/linki-client";
import type { WorkerContext } from "../context";

/**
 * Mirrors Linki (sales/outreach) data into Falorb's own Postgres, per org.
 *
 * A full paginated poll every run, not an incremental watermark sweep —
 * unlike `webhooks.ts`, Linki has no outbound event stream to consume
 * incrementally (confirmed during the Phase L2 API audit). Every table is
 * upserted on `(organizationId, linkiId)`, so re-polling is idempotent
 * regardless of pagination order or a run that only partially completes.
 *
 * "Watermark" here is connection health, not a cursor: `lastSyncedAt` on
 * `integrationConnections` records when a full sync last completed, stored in
 * Postgres alongside the connection itself rather than in Redis — this is
 * state worth keeping durably, not a cache.
 */

const PAGE_SIZE = 200;

export async function syncLinki(context: WorkerContext): Promise<void> {
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.provider, "linki"),
        eq(schema.integrationConnections.status, "active"),
      ),
    );

  for (const connection of connections) {
    try {
      await syncOrg(context, connection);
    } catch (error) {
      console.error(`[linki-sync] org ${connection.organizationId} failed:`, String(error));
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
  const client = new LinkiClient({ baseUrl: connection.baseUrl, apiKey });

  const contacts = await paginateAll((limit, offset) =>
    client.listContacts({ limit, offset }).then((p) => p.data),
  );
  await upsertContacts(context, orgId, contacts);
  await linkContactsToPersons(context, orgId);

  const lists = await paginateAll((limit, offset) =>
    client.listLists({ limit, offset }).then((p) => p.data),
  );
  await upsertLists(context, orgId, lists);

  const listMembers: LinkiListMember[] = [];
  for (const list of lists) {
    listMembers.push(
      ...(await paginateAll((limit, offset) =>
        client.listListMembers(list.id, { limit, offset }).then((p) => p.data),
      )),
    );
  }
  await upsertListMembers(context, orgId, listMembers);

  const workflows = await paginateAll((limit, offset) =>
    client.listWorkflows({ limit, offset }).then((p) => p.data),
  );
  await upsertWorkflows(context, orgId, workflows);

  const runs = await paginateAll((limit, offset) =>
    client.listRuns({ limit, offset }).then((p) => p.data),
  );
  await upsertRuns(context, orgId, runs);

  const runProfiles: LinkiRunProfile[] = [];
  const runProfileTracks: LinkiRunProfileTrack[] = [];
  for (const run of runs) {
    runProfiles.push(
      ...(await paginateAll((limit, offset) =>
        client.listRunProfiles(run.id, { limit, offset }).then((p) => p.data),
      )),
    );
    runProfileTracks.push(
      ...(await paginateAll((limit, offset) =>
        client.listRunProfileTracks(run.id, { limit, offset }).then((p) => p.data),
      )),
    );
  }
  await upsertRunProfiles(context, orgId, runProfiles);
  await upsertRunProfileTracks(context, orgId, runProfileTracks);

  const signalRules = await paginateAll((limit, offset) =>
    client.listSignalRules({ limit, offset }).then((p) => p.data),
  );
  await upsertSignalRules(context, orgId, signalRules);

  const suppressions = await paginateAll((limit, offset) =>
    client.listSuppressions({ limit, offset }).then((p) => p.data),
  );
  await upsertSuppressions(context, orgId, suppressions);

  const sentMessages = await paginateAll((limit, offset) =>
    client.listSentMessages({ limit, offset }).then((p) => p.data),
  );
  await upsertSentMessages(context, orgId, sentMessages);

  await context.db
    .update(schema.integrationConnections)
    .set({ lastSyncedAt: new Date(), status: "active", lastError: null, updatedAt: new Date() })
    .where(eq(schema.integrationConnections.id, connection.id));

  console.log(
    `[linki-sync] org ${orgId}: ${contacts.length} contacts, ${lists.length} lists, ${workflows.length} workflows, ${runs.length} runs`,
  );
}

/** Repeatedly fetches pages until one comes back shorter than requested. */
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

async function upsertContacts(context: WorkerContext, orgId: string, rows: LinkiContact[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmContacts)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        fullName: r.full_name,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        phone: r.phone,
        title: r.title,
        company: r.company,
        location: r.location,
        linkedinUrl: r.linkedin_url,
        ownerLinkiId: (r.owner_id as string | null) ?? null,
        linkiCreatedAt: toDate(r.created_at),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmContacts.organizationId, schema.crmContacts.linkiId],
      set: {
        fullName: sql`excluded.full_name`,
        firstName: sql`excluded.first_name`,
        lastName: sql`excluded.last_name`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        title: sql`excluded.title`,
        company: sql`excluded.company`,
        location: sql`excluded.location`,
        linkedinUrl: sql`excluded.linkedin_url`,
        ownerLinkiId: sql`excluded.owner_linki_id`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

/**
 * Backfills `crmContacts.personId` by email match against Falorb's own
 * `persons` — the CRM↔analytics join point. Deliberately a single set-based
 * update rather than one lookup per contact: cheap, and re-running it after
 * every sync self-heals as new persons or contacts appear on either side.
 * Never overwrites an existing match, and never touches `persons` itself.
 */
async function linkContactsToPersons(context: WorkerContext, orgId: string): Promise<void> {
  await context.db.execute(sql`
    UPDATE crm_contacts cc
    SET person_id = p.id
    FROM persons p
    WHERE cc.organization_id = ${orgId}
      AND p.organization_id = ${orgId}
      AND cc.person_id IS NULL
      AND cc.email IS NOT NULL
      AND p.email IS NOT NULL
      AND lower(cc.email) = lower(p.email)
  `);
}

async function upsertLists(context: WorkerContext, orgId: string, rows: LinkiList[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmLists)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        name: r.name,
        description: r.description,
        purpose: r.purpose,
        linkiCreatedAt: toDate(r.created_at),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmLists.organizationId, schema.crmLists.linkiId],
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        purpose: sql`excluded.purpose`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

async function upsertListMembers(
  context: WorkerContext,
  orgId: string,
  rows: LinkiListMember[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmListMembers)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        listLinkiId: r.list_id,
        targetLinkiId: r.target_id,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [
        schema.crmListMembers.organizationId,
        schema.crmListMembers.listLinkiId,
        schema.crmListMembers.targetLinkiId,
      ],
      set: { syncedAt: sql`excluded.synced_at` },
    });

  // Resolve listId/contactId now that both sides exist — same reasoning as linkContactsToPersons.
  await context.db.execute(sql`
    UPDATE crm_list_members m SET list_id = l.id
    FROM crm_lists l
    WHERE m.organization_id = ${orgId} AND l.organization_id = ${orgId} AND m.list_linki_id = l.linki_id AND m.list_id IS NULL
  `);
  await context.db.execute(sql`
    UPDATE crm_list_members m SET contact_id = c.id
    FROM crm_contacts c
    WHERE m.organization_id = ${orgId} AND c.organization_id = ${orgId} AND m.target_linki_id = c.linki_id AND m.contact_id IS NULL
  `);
}

async function upsertWorkflows(context: WorkerContext, orgId: string, rows: LinkiWorkflow[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmWorkflows)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        name: r.name,
        description: r.description,
        linkiCreatedAt: toDate(r.created_at),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmWorkflows.organizationId, schema.crmWorkflows.linkiId],
      set: { name: sql`excluded.name`, description: sql`excluded.description`, syncedAt: sql`excluded.synced_at` },
    });
}


async function upsertRuns(context: WorkerContext, orgId: string, rows: LinkiRun[]): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmRuns)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        workflowLinkiId: r.workflow_id,
        listLinkiId: r.list_id,
        status: r.status,
        linkiCreatedAt: toDate(r.created_at),
        startedAt: toDate(r.started_at),
        completedAt: toDate(r.completed_at),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmRuns.organizationId, schema.crmRuns.linkiId],
      set: {
        status: sql`excluded.status`,
        startedAt: sql`excluded.started_at`,
        completedAt: sql`excluded.completed_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await context.db.execute(sql`
    UPDATE crm_runs r SET workflow_id = w.id
    FROM crm_workflows w
    WHERE r.organization_id = ${orgId} AND w.organization_id = ${orgId} AND r.workflow_linki_id = w.linki_id AND r.workflow_id IS NULL
  `);
  await context.db.execute(sql`
    UPDATE crm_runs r SET list_id = l.id
    FROM crm_lists l
    WHERE r.organization_id = ${orgId} AND l.organization_id = ${orgId} AND r.list_linki_id = l.linki_id AND r.list_id IS NULL
  `);
}

async function upsertRunProfiles(
  context: WorkerContext,
  orgId: string,
  rows: LinkiRunProfile[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmRunProfiles)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        runLinkiId: r.run_id,
        targetLinkiId: r.target_id,
        linkiCreatedAt: toDate(r.created_at),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmRunProfiles.organizationId, schema.crmRunProfiles.linkiId],
      set: { syncedAt: sql`excluded.synced_at` },
    });

  await resolveRunAndContact(context, orgId, "crm_run_profiles");
}

async function upsertRunProfileTracks(
  context: WorkerContext,
  orgId: string,
  rows: LinkiRunProfileTrack[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmRunProfileTracks)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        runProfileLinkiId: r.run_profile_id,
        runLinkiId: r.run_id,
        targetLinkiId: r.target_id,
        track: r.track,
        state: r.state,
        currentStep: r.current_step,
        lastStepAt: toDate(r.last_step_at),
        nextStepAt: toDate(r.next_step_at),
        errorMessage: r.error_message,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmRunProfileTracks.organizationId, schema.crmRunProfileTracks.linkiId],
      set: {
        state: sql`excluded.state`,
        currentStep: sql`excluded.current_step`,
        lastStepAt: sql`excluded.last_step_at`,
        nextStepAt: sql`excluded.next_step_at`,
        errorMessage: sql`excluded.error_message`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await resolveRunAndContact(context, orgId, "crm_run_profile_tracks");
}

/** Shared resolver for the two tables keyed by (runLinkiId, targetLinkiId) -> (runId, contactId). */
async function resolveRunAndContact(
  context: WorkerContext,
  orgId: string,
  table: "crm_run_profiles" | "crm_run_profile_tracks",
): Promise<void> {
  await context.db.execute(sql`
    UPDATE ${sql.identifier(table)} t SET run_id = r.id
    FROM crm_runs r
    WHERE t.organization_id = ${orgId} AND r.organization_id = ${orgId} AND t.run_linki_id = r.linki_id AND t.run_id IS NULL
  `);
  await context.db.execute(sql`
    UPDATE ${sql.identifier(table)} t SET contact_id = c.id
    FROM crm_contacts c
    WHERE t.organization_id = ${orgId} AND c.organization_id = ${orgId} AND t.target_linki_id = c.linki_id AND t.contact_id IS NULL
  `);
}


async function upsertSignalRules(
  context: WorkerContext,
  orgId: string,
  rows: LinkiSignalRule[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmSignalRules)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        name: r.name,
        signalType: r.signal_type,
        minScore: String(r.min_score),
        listLinkiId: r.list_id,
        workflowLinkiId: r.workflow_id,
        enabled: Boolean(r.enabled),
        autoStart: Boolean(r.auto_start),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmSignalRules.organizationId, schema.crmSignalRules.linkiId],
      set: {
        name: sql`excluded.name`,
        minScore: sql`excluded.min_score`,
        listLinkiId: sql`excluded.list_linki_id`,
        workflowLinkiId: sql`excluded.workflow_linki_id`,
        enabled: sql`excluded.enabled`,
        autoStart: sql`excluded.auto_start`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

async function upsertSuppressions(
  context: WorkerContext,
  orgId: string,
  rows: LinkiSuppression[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmSuppressions)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        kind: r.kind,
        value: r.value,
        reason: r.reason,
        targetLinkiId: r.target_id,
        linkiCreatedAt: toDate(r.created_at),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmSuppressions.organizationId, schema.crmSuppressions.linkiId],
      set: { syncedAt: sql`excluded.synced_at` },
    });
}

async function upsertSentMessages(
  context: WorkerContext,
  orgId: string,
  rows: LinkiSentMessage[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.crmSentMessages)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        linkiId: r.id,
        targetLinkiId: r.target_id,
        runLinkiId: r.run_id,
        recipient: r.recipient,
        subject: r.subject,
        status: r.status,
        acceptedAt: toDate(r.accepted_at),
        deliveredAt: toDate(r.delivered_at),
        bouncedAt: toDate(r.bounced_at),
        complainedAt: toDate(r.complained_at),
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [schema.crmSentMessages.organizationId, schema.crmSentMessages.linkiId],
      set: {
        status: sql`excluded.status`,
        deliveredAt: sql`excluded.delivered_at`,
        bouncedAt: sql`excluded.bounced_at`,
        complainedAt: sql`excluded.complained_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await context.db.execute(sql`
    UPDATE crm_sent_messages m SET contact_id = c.id
    FROM crm_contacts c
    WHERE m.organization_id = ${orgId} AND c.organization_id = ${orgId} AND m.target_linki_id = c.linki_id AND m.contact_id IS NULL
  `);
}
