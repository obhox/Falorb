import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * The Stripe billing mirror, read-side — a read-only mirror of the
 * operator's own Stripe account (see FEATURES.md §20), written by
 * `apps/worker/src/jobs/stripe-sync.ts`. There is no `actions/billing.ts`:
 * this integration has no write path at all yet (no refunds, no
 * subscription changes, no invoice creation — see FEATURES.md §20's "Not
 * yet built"), so there is nothing here to act on, only to read.
 *
 * Amounts are returned exactly as Stripe stores them: integers in the
 * smallest currency unit (cents for USD). Callers divide by 100 before
 * handing a value to `money()` (`@/lib/format`) — this file deliberately
 * does no currency-aware rounding of its own (a handful of currencies, JPY
 * among them, have no minor unit at all), matching the same simplification
 * `@falorb/stripe-client`'s docblock already accepts for a v1 mirror.
 *
 * Every function here takes an optional `projectId`. Omitted (the default),
 * every query is scoped to the organization's own org-level Stripe
 * connection's mirrored rows (`projectId IS NULL`) — this is `/billing`'s
 * existing behavior, unchanged, for organizations that have only ever
 * connected one Stripe account at the org level. Passed, every query is
 * scoped to that one project's own Stripe connection's mirrored rows
 * instead (`projectId = <value>`) — `/p/[project]/billing`'s view, for an
 * operator running more than one product (each with its own Stripe account)
 * under one Falorb organization. The two scopes never blend: a project's
 * own connection's data and the org-level connection's data are always
 * queried separately, matching the partial-unique-index split in
 * `packages/db/src/schema/billing.ts`.
 */

export async function isStripeConnected(organizationId: string, projectId?: number): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.integrationConnections.id })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        projectId != null
          ? eq(schema.integrationConnections.projectId, projectId)
          : isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "stripe"),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type StripeCustomerRow = typeof schema.stripeCustomers.$inferSelect;
export type StripeSubscriptionRow = typeof schema.stripeSubscriptions.$inferSelect;
export type StripeInvoiceRow = typeof schema.stripeInvoices.$inferSelect;
export type StripeChargeRow = typeof schema.stripeCharges.$inferSelect;

export async function listCustomers(organizationId: string, projectId?: number): Promise<StripeCustomerRow[]> {
  return db()
    .select()
    .from(schema.stripeCustomers)
    .where(
      and(
        eq(schema.stripeCustomers.organizationId, organizationId),
        projectId != null
          ? eq(schema.stripeCustomers.projectId, projectId)
          : isNull(schema.stripeCustomers.projectId),
      ),
    )
    .orderBy(desc(schema.stripeCustomers.syncedAt))
    .limit(500);
}

export async function listSubscriptions(
  organizationId: string,
  projectId?: number,
): Promise<StripeSubscriptionRow[]> {
  return db()
    .select()
    .from(schema.stripeSubscriptions)
    .where(
      and(
        eq(schema.stripeSubscriptions.organizationId, organizationId),
        projectId != null
          ? eq(schema.stripeSubscriptions.projectId, projectId)
          : isNull(schema.stripeSubscriptions.projectId),
      ),
    )
    .orderBy(desc(schema.stripeSubscriptions.stripeCreatedAt))
    .limit(500);
}

export async function listInvoices(organizationId: string, projectId?: number): Promise<StripeInvoiceRow[]> {
  return db()
    .select()
    .from(schema.stripeInvoices)
    .where(
      and(
        eq(schema.stripeInvoices.organizationId, organizationId),
        projectId != null ? eq(schema.stripeInvoices.projectId, projectId) : isNull(schema.stripeInvoices.projectId),
      ),
    )
    .orderBy(desc(schema.stripeInvoices.stripeCreatedAt))
    .limit(500);
}

export async function listCharges(organizationId: string, projectId?: number): Promise<StripeChargeRow[]> {
  return db()
    .select()
    .from(schema.stripeCharges)
    .where(
      and(
        eq(schema.stripeCharges.organizationId, organizationId),
        projectId != null ? eq(schema.stripeCharges.projectId, projectId) : isNull(schema.stripeCharges.projectId),
      ),
    )
    .orderBy(desc(schema.stripeCharges.stripeCreatedAt))
    .limit(500);
}

export interface BillingSummary {
  totalCustomers: number;
  activeSubscriptions: number;
  /** MRR estimate per currency — an array rather than a single number since a Stripe account can bill in more than one currency, and summing across currencies would be meaningless. */
  mrrByCurrency: Array<{ currency: string; amount: number }>;
  openInvoices: number;
  /** Charges with `status = 'failed'` in the last 30 days — the "payment health" half of this integration's stated purpose. */
  failedChargesLast30d: number;
}

/**
 * The `/billing` (or `/p/[project]/billing`, when `projectId` is passed)
 * summary row — every figure is a cheap indexed count or a `GROUP BY` over
 * already-mirrored rows, not a live Stripe call: this page reads Postgres,
 * same as `/crm`/`/support`, and shows whatever `stripe-sync.ts` last wrote.
 */
export async function getBillingSummary(organizationId: string, projectId?: number): Promise<BillingSummary> {
  const database = db();

  const [[customerCount], mrrRows, [openInvoiceCount], [failedChargeCount]] = await Promise.all([
    database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stripeCustomers)
      .where(
        and(
          eq(schema.stripeCustomers.organizationId, organizationId),
          projectId != null
            ? eq(schema.stripeCustomers.projectId, projectId)
            : isNull(schema.stripeCustomers.projectId),
        ),
      ),
    database
      .select({
        currency: schema.stripeSubscriptions.currency,
        activeCount: sql<number>`count(*)::int`,
        mrr: sql<number>`coalesce(sum(${schema.stripeSubscriptions.monthlyAmountEstimate}), 0)::int`,
      })
      .from(schema.stripeSubscriptions)
      .where(
        and(
          eq(schema.stripeSubscriptions.organizationId, organizationId),
          projectId != null
            ? eq(schema.stripeSubscriptions.projectId, projectId)
            : isNull(schema.stripeSubscriptions.projectId),
          eq(schema.stripeSubscriptions.status, "active"),
        ),
      )
      .groupBy(schema.stripeSubscriptions.currency),
    database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stripeInvoices)
      .where(
        and(
          eq(schema.stripeInvoices.organizationId, organizationId),
          projectId != null
            ? eq(schema.stripeInvoices.projectId, projectId)
            : isNull(schema.stripeInvoices.projectId),
          eq(schema.stripeInvoices.status, "open"),
        ),
      ),
    database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.stripeCharges)
      .where(
        and(
          eq(schema.stripeCharges.organizationId, organizationId),
          projectId != null ? eq(schema.stripeCharges.projectId, projectId) : isNull(schema.stripeCharges.projectId),
          eq(schema.stripeCharges.status, "failed"),
          gte(schema.stripeCharges.stripeCreatedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        ),
      ),
  ]);

  return {
    totalCustomers: customerCount?.count ?? 0,
    activeSubscriptions: mrrRows.reduce((sum, r) => sum + r.activeCount, 0),
    mrrByCurrency: mrrRows.map((r) => ({ currency: r.currency, amount: r.mrr })),
    openInvoices: openInvoiceCount?.count ?? 0,
    failedChargesLast30d: failedChargeCount?.count ?? 0,
  };
}
