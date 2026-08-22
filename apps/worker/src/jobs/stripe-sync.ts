import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { decryptCredential, schema } from "@falorb/db";
import {
  StripeClient,
  type StripeCharge,
  type StripeCustomer,
  type StripeInvoice,
  type StripeSubscription,
} from "@falorb/stripe-client";
import { isSyncStale } from "@falorb/core";
import type { WorkerContext } from "../context";

/**
 * Mirrors Stripe (the operator's own payment processing account) into
 * Falorb's own Postgres — one connection at a time, org-level or
 * project-level, same shape as `linki-sync.ts`/`bund-ai-sync.ts`: a full
 * paginated poll per synced connection (Stripe has no incremental event
 * stream this job consumes — Events exist but reading them is a separate,
 * webhook-shaped integration this repo deliberately doesn't build yet, see
 * FEATURES.md §20's "Not yet built"), upsert on `(organizationId, stripeId)`
 * (org-level rows) or `(organizationId, projectId, stripeId)` (project-level
 * rows), `lastSyncedAt`/`status`/`lastError` on `integrationConnections` as
 * the connection-health signal and the cooldown clock below.
 *
 * Demand-driven, not a blind sweep — see `buffer-sync.ts`'s doc comment for
 * why. `context.syncDemand` is flagged by `apps/web/src/server/billing.ts` (a
 * page load) and `.../actions/integrations.ts` (a fresh connect), keyed by
 * `organizationId` alone — draining it and matching on organizationId below
 * picks up that org's org-level connection *and* every project-level
 * override together, since `listCustomers`/etc. in `billing.ts` are always
 * scoped by organizationId first. This only calls Stripe for orgs flagged
 * since the last tick, gated further by `SYNC_COOLDOWN_MS` per connection.
 *
 * Unlike Linki/Bund AI, every `StripeClient.list*` method already
 * cursor-walks every page internally (see that package's docblock), so this
 * job never drives pagination itself — the same division of labor
 * `buffer-sync.ts` has with `BufferClient.listPosts`.
 *
 * Customers are synced first, and every other table resolves its
 * `customerId`/`subscriptionId` foreign key from the just-synced parent by a
 * `stripeId` match — same "sync child after parent, resolve FKs with a
 * set-based UPDATE" shape as `linki-sync.ts`'s `resolveRunAndContact`. Every
 * one of those resolution queries is scoped by `projectId` (not just
 * `organizationId`), so a subscription synced from one project's Stripe
 * account only ever resolves its `customerId` against that same project's
 * (or the org-level connection's) mirrored customers — never a sibling
 * project's, even though they share an `organizationId`.
 */

const SYNC_COOLDOWN_MS = 5 * 60_000;

export async function syncStripe(context: WorkerContext): Promise<void> {
  const requestedOrgIds = await context.syncDemand.drain("stripe");
  if (!requestedOrgIds.length) return;

  // Every active Stripe connection for a flagged org — the org-level one
  // (`projectId` null) and every project's own override. An operator running
  // more than one product under one Falorb organization connects a separate
  // Stripe account per project (each with its own DBA); each connection is
  // synced, and reported on, independently — one project's bad key marks
  // only that project's connection errored, never the org-level one or a
  // sibling project's.
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.provider, "stripe"),
        eq(schema.integrationConnections.status, "active"),
        inArray(schema.integrationConnections.organizationId, requestedOrgIds),
      ),
    );

  for (const connection of connections) {
    if (!isSyncStale(connection.lastSyncedAt, SYNC_COOLDOWN_MS)) continue;
    try {
      await syncConnection(context, connection);
    } catch (error) {
      const scope =
        connection.projectId != null
          ? `org ${connection.organizationId} project ${connection.projectId}`
          : `org ${connection.organizationId}`;
      console.error(`[stripe-sync] ${scope} failed:`, String(error));
      const status = (error as { status?: number; statusCode?: number })?.status
        ?? (error as { statusCode?: number })?.statusCode;
      if (status === 429) {
        console.warn(`[stripe-sync] ${scope} rate-limited, will retry later`);
      } else {
        await context.db
          .update(schema.integrationConnections)
          .set({ status: "error", lastError: String(error), updatedAt: new Date() })
          .where(eq(schema.integrationConnections.id, connection.id));
      }
    }
  }
}

async function syncConnection(
  context: WorkerContext,
  connection: typeof schema.integrationConnections.$inferSelect,
): Promise<void> {
  const orgId = connection.organizationId;
  const projectId = connection.projectId;
  const apiKey = decryptCredential({
    ciphertext: connection.encryptedApiKey,
    iv: connection.iv,
    authTag: connection.authTag,
  });
  const client = new StripeClient({ baseUrl: connection.baseUrl, apiKey });

  const customers = await client.listCustomers();
  await upsertCustomers(context, orgId, projectId, customers);
  await linkCustomersToPersons(context, orgId);

  const subscriptions = await client.listSubscriptions();
  await upsertSubscriptions(context, orgId, projectId, subscriptions);

  const invoices = await client.listInvoices();
  await upsertInvoices(context, orgId, projectId, invoices);

  const charges = await client.listCharges();
  await upsertCharges(context, orgId, projectId, charges);

  await context.db
    .update(schema.integrationConnections)
    .set({ lastSyncedAt: new Date(), status: "active", lastError: null, updatedAt: new Date() })
    .where(eq(schema.integrationConnections.id, connection.id));

  const scope = projectId != null ? `org ${orgId} project ${projectId}` : `org ${orgId}`;
  console.log(
    `[stripe-sync] ${scope}: ${customers.length} customers, ${subscriptions.length} subscriptions, ${invoices.length} invoices, ${charges.length} charges`,
  );
}

/**
 * The org-level partial unique index is `(organizationId, stripeId)` WHERE
 * `project_id IS NULL`; the project-level one is
 * `(organizationId, projectId, stripeId)` WHERE `project_id IS NOT NULL` —
 * see `packages/db/src/schema/billing.ts`. Postgres' `ON CONFLICT` needs the
 * exact column list *and* partial-index predicate to infer which index a
 * statement targets, so which pair a given upsert uses depends on whether
 * this batch is org-level or project-level — every row in one call shares
 * the same `projectId` (one connection, synced in one call), so the choice
 * is made once per call rather than per row.
 */
function stripeConflictTarget(
  projectId: number | null,
  organizationIdCol: PgColumn,
  projectIdCol: PgColumn,
  stripeIdCol: PgColumn,
): { target: PgColumn[]; targetWhere: ReturnType<typeof sql> } {
  return projectId != null
    ? {
        target: [organizationIdCol, projectIdCol, stripeIdCol],
        targetWhere: sql`${projectIdCol} is not null`,
      }
    : {
        target: [organizationIdCol, stripeIdCol],
        targetWhere: sql`${projectIdCol} is null`,
      };
}

async function upsertCustomers(
  context: WorkerContext,
  orgId: string,
  projectId: number | null,
  rows: StripeCustomer[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.stripeCustomers)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        projectId,
        stripeId: r.id,
        email: r.email,
        name: r.name,
        phone: r.phone,
        currency: r.currency,
        delinquent: r.delinquent,
        stripeCreatedAt: r.createdAt,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      ...stripeConflictTarget(
        projectId,
        schema.stripeCustomers.organizationId,
        schema.stripeCustomers.projectId,
        schema.stripeCustomers.stripeId,
      ),
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        phone: sql`excluded.phone`,
        currency: sql`excluded.currency`,
        delinquent: sql`excluded.delinquent`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
}

/**
 * Backfills `stripeCustomers.personId` by email match against Falorb's own
 * `persons` — the billing↔analytics join point. Same shape as
 * `linki-sync.ts`'s `linkContactsToPersons`: a single set-based update,
 * never overwrites an existing match, never touches `persons` itself.
 */
async function linkCustomersToPersons(context: WorkerContext, orgId: string): Promise<void> {
  await context.db.execute(sql`
    UPDATE stripe_customers sc
    SET person_id = p.id
    FROM persons p
    WHERE sc.organization_id = ${orgId}
      AND p.organization_id = ${orgId}
      AND sc.person_id IS NULL
      AND sc.email IS NOT NULL
      AND p.email IS NOT NULL
      AND lower(sc.email) = lower(p.email)
  `);
}

async function upsertSubscriptions(
  context: WorkerContext,
  orgId: string,
  projectId: number | null,
  rows: StripeSubscription[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.stripeSubscriptions)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        projectId,
        stripeId: r.id,
        customerStripeId: r.customerId,
        status: r.status,
        amountPerCycle: r.amountPerCycle,
        currency: r.currency,
        interval: r.interval,
        intervalCount: r.intervalCount,
        monthlyAmountEstimate: Math.round(r.monthlyAmountEstimate),
        cancelAtPeriodEnd: r.cancelAtPeriodEnd,
        currentPeriodStart: r.currentPeriodStart,
        currentPeriodEnd: r.currentPeriodEnd,
        canceledAt: r.canceledAt,
        stripeCreatedAt: r.createdAt,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      ...stripeConflictTarget(
        projectId,
        schema.stripeSubscriptions.organizationId,
        schema.stripeSubscriptions.projectId,
        schema.stripeSubscriptions.stripeId,
      ),
      set: {
        status: sql`excluded.status`,
        amountPerCycle: sql`excluded.amount_per_cycle`,
        currency: sql`excluded.currency`,
        interval: sql`excluded.interval`,
        intervalCount: sql`excluded.interval_count`,
        monthlyAmountEstimate: sql`excluded.monthly_amount_estimate`,
        cancelAtPeriodEnd: sql`excluded.cancel_at_period_end`,
        currentPeriodStart: sql`excluded.current_period_start`,
        currentPeriodEnd: sql`excluded.current_period_end`,
        canceledAt: sql`excluded.canceled_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await context.db.execute(sql`
    UPDATE stripe_subscriptions s SET customer_id = c.id
    FROM stripe_customers c
    WHERE s.organization_id = ${orgId} AND c.organization_id = ${orgId}
      AND s.project_id IS NOT DISTINCT FROM ${projectId} AND c.project_id IS NOT DISTINCT FROM ${projectId}
      AND s.customer_stripe_id = c.stripe_id AND s.customer_id IS NULL
  `);
}

async function upsertInvoices(
  context: WorkerContext,
  orgId: string,
  projectId: number | null,
  rows: StripeInvoice[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.stripeInvoices)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        projectId,
        stripeId: r.id,
        customerStripeId: r.customerId || null,
        subscriptionStripeId: r.subscriptionId,
        status: r.status,
        amountDue: r.amountDue,
        amountPaid: r.amountPaid,
        amountRemaining: r.amountRemaining,
        currency: r.currency,
        number: r.number,
        hostedInvoiceUrl: r.hostedInvoiceUrl,
        invoicePdf: r.invoicePdf,
        dueDate: r.dueDate,
        paidAt: r.paidAt,
        stripeCreatedAt: r.createdAt,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      ...stripeConflictTarget(
        projectId,
        schema.stripeInvoices.organizationId,
        schema.stripeInvoices.projectId,
        schema.stripeInvoices.stripeId,
      ),
      set: {
        status: sql`excluded.status`,
        amountDue: sql`excluded.amount_due`,
        amountPaid: sql`excluded.amount_paid`,
        amountRemaining: sql`excluded.amount_remaining`,
        number: sql`excluded.number`,
        hostedInvoiceUrl: sql`excluded.hosted_invoice_url`,
        invoicePdf: sql`excluded.invoice_pdf`,
        dueDate: sql`excluded.due_date`,
        paidAt: sql`excluded.paid_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await context.db.execute(sql`
    UPDATE stripe_invoices i SET customer_id = c.id
    FROM stripe_customers c
    WHERE i.organization_id = ${orgId} AND c.organization_id = ${orgId}
      AND i.project_id IS NOT DISTINCT FROM ${projectId} AND c.project_id IS NOT DISTINCT FROM ${projectId}
      AND i.customer_stripe_id = c.stripe_id AND i.customer_id IS NULL
  `);
  await context.db.execute(sql`
    UPDATE stripe_invoices i SET subscription_id = s.id
    FROM stripe_subscriptions s
    WHERE i.organization_id = ${orgId} AND s.organization_id = ${orgId}
      AND i.project_id IS NOT DISTINCT FROM ${projectId} AND s.project_id IS NOT DISTINCT FROM ${projectId}
      AND i.subscription_stripe_id = s.stripe_id AND i.subscription_id IS NULL
  `);
}

async function upsertCharges(
  context: WorkerContext,
  orgId: string,
  projectId: number | null,
  rows: StripeCharge[],
): Promise<void> {
  if (!rows.length) return;
  await context.db
    .insert(schema.stripeCharges)
    .values(
      rows.map((r) => ({
        organizationId: orgId,
        projectId,
        stripeId: r.id,
        customerStripeId: r.customerId,
        amount: r.amount,
        amountRefunded: r.amountRefunded,
        currency: r.currency,
        status: r.status,
        paid: r.paid,
        refunded: r.refunded,
        disputed: r.disputed,
        failureCode: r.failureCode,
        failureMessage: r.failureMessage,
        description: r.description,
        receiptUrl: r.receiptUrl,
        stripeCreatedAt: r.createdAt,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      ...stripeConflictTarget(
        projectId,
        schema.stripeCharges.organizationId,
        schema.stripeCharges.projectId,
        schema.stripeCharges.stripeId,
      ),
      set: {
        amountRefunded: sql`excluded.amount_refunded`,
        status: sql`excluded.status`,
        paid: sql`excluded.paid`,
        refunded: sql`excluded.refunded`,
        disputed: sql`excluded.disputed`,
        failureCode: sql`excluded.failure_code`,
        failureMessage: sql`excluded.failure_message`,
        receiptUrl: sql`excluded.receipt_url`,
        syncedAt: sql`excluded.synced_at`,
      },
    });

  await context.db.execute(sql`
    UPDATE stripe_charges ch SET customer_id = c.id
    FROM stripe_customers c
    WHERE ch.organization_id = ${orgId} AND c.organization_id = ${orgId}
      AND ch.project_id IS NOT DISTINCT FROM ${projectId} AND c.project_id IS NOT DISTINCT FROM ${projectId}
      AND ch.customer_stripe_id = c.stripe_id AND ch.customer_id IS NULL
  `);
}
