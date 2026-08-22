import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/session";
import {
  getBillingSummary,
  isStripeConnected,
  listCharges,
  listCustomers,
  listInvoices,
  listSubscriptions,
} from "@/server/billing";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { StatStrip } from "@/components/StatStrip";
import { money } from "@/lib/format";
import { BillingTabsPanel } from "./BillingTabsPanel";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

/**
 * Stripe billing, mirrored — read-only (FEATURES.md §20). Same shape as
 * `/crm`/`/support`: gated behind a live connection, backed entirely by
 * what `apps/worker/src/jobs/stripe-sync.ts` last wrote into Postgres, no
 * live Stripe call on this request path.
 *
 * This is the operator's OWN Stripe account — the business run *through*
 * Falorb — not Falorb's own SaaS billing for itself.
 */
export default async function BillingPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const connected = await isStripeConnected(orgId);
  if (!connected) {
    return (
      <>
        <PageHeader title="Billing" meta={session.workspace.organizationName} />
        <PageBody>
          <Empty
            icon="credit-card"
            title="Stripe isn't connected"
            body="Connect your Stripe account to see customers, subscriptions, invoices, and charges here — a read-only mirror of your own revenue and payment health."
            action={
              <Link href="/settings/integrations" style={{ textDecoration: "none" }}>
                Connect in Settings → Integrations
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const [summary, customers, subscriptions, invoices, charges] = await Promise.all([
    getBillingSummary(orgId),
    listCustomers(orgId),
    listSubscriptions(orgId),
    listInvoices(orgId),
    listCharges(orgId),
  ]);

  const customerById = new Map(customers.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title="Billing" meta={`${summary.totalCustomers} customers · ${summary.activeSubscriptions} active subscriptions`} />
      <PageBody>
        <StatStrip
          stats={[
            {
              label: "MRR estimate",
              value:
                summary.mrrByCurrency.length === 0
                  ? money(0)
                  : summary.mrrByCurrency
                      .map((r) => money(r.amount / 100, r.currency.toUpperCase()))
                      .join(" + "),
              footnote:
                summary.mrrByCurrency.length > 1
                  ? "summed per currency — not combined, currencies aren't fungible"
                  : "from active subscriptions",
            },
            { label: "Active subscriptions", value: String(summary.activeSubscriptions) },
            { label: "Open invoices", value: String(summary.openInvoices) },
            {
              label: "Failed charges (30d)",
              value: String(summary.failedChargesLast30d),
              invertDelta: true,
            },
          ]}
        />

        <BillingTabsPanel
          customers={customers.map((c) => ({
            id: c.id,
            email: c.email,
            name: c.name,
            phone: c.phone,
            currency: c.currency,
            delinquent: c.delinquent,
            personId: c.personId,
            syncedAt: c.syncedAt.toISOString(),
          }))}
          subscriptions={subscriptions.map((s) => ({
            id: s.id,
            customerEmail: (s.customerId && customerById.get(s.customerId)?.email) ?? s.customerStripeId,
            status: s.status,
            amountPerCycle: s.amountPerCycle,
            currency: s.currency,
            interval: s.interval,
            intervalCount: s.intervalCount,
            cancelAtPeriodEnd: s.cancelAtPeriodEnd,
            currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
          }))}
          invoices={invoices.map((i) => ({
            id: i.id,
            customerEmail: (i.customerId && customerById.get(i.customerId)?.email) ?? i.customerStripeId,
            status: i.status,
            amountDue: i.amountDue,
            amountPaid: i.amountPaid,
            currency: i.currency,
            number: i.number,
            hostedInvoiceUrl: i.hostedInvoiceUrl,
            dueDate: i.dueDate?.toISOString() ?? null,
          }))}
          charges={charges.map((c) => ({
            id: c.id,
            customerEmail: (c.customerId && customerById.get(c.customerId)?.email) ?? c.customerStripeId,
            status: c.status,
            amount: c.amount,
            amountRefunded: c.amountRefunded,
            currency: c.currency,
            refunded: c.refunded,
            disputed: c.disputed,
            failureMessage: c.failureMessage,
            receiptUrl: c.receiptUrl,
            createdAt: c.stripeCreatedAt?.toISOString() ?? null,
          }))}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
