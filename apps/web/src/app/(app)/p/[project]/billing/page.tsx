import type { Metadata } from "next";
import Link from "next/link";
import { requireProject } from "@/server/session";
import {
  getBillingSummary,
  isStripeConnected,
  listCharges,
  listCustomers,
  listInvoices,
  listSubscriptions,
} from "@/server/billing";
import { PageBody } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { StatStrip } from "@/components/StatStrip";
import { money } from "@/lib/format";
import { BillingTabsPanel } from "../../../billing/BillingTabsPanel";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

/**
 * A property's own Stripe billing, mirrored — read-only (FEATURES.md §20).
 * Same shape as the org-wide `/billing` page, but scoped to this project's
 * own Stripe connection rather than the organization's: an operator running
 * more than one product (each with its own DBA/Stripe account) under one
 * Falorb organization connects Stripe separately per property
 * (Settings → Integrations, on this property), and this page shows only
 * that property's own mirrored customers, subscriptions, invoices, and
 * charges — never blended with a sibling property's or the organization's
 * own org-level connection, matching the `projectId` scoping in
 * `apps/web/src/server/billing.ts`.
 *
 * This is the operator's OWN Stripe account for this product — not
 * Falorb's own SaaS billing for itself.
 */
export default async function ProjectBillingPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { session, project } = await requireProject((await params).project);
  const orgId = session.workspace.organizationId;

  const connected = await isStripeConnected(orgId, project.id);
  if (!connected) {
    return (
      <PageBody>
        <Empty
          icon="credit-card"
          title="Stripe isn't connected for this property"
          body="Connect a Stripe account for this property alone to see its own customers, subscriptions, invoices, and charges here — separate from the organization's connection or any other property's."
          action={
            <Link href={`/p/${project.slug}/settings`} style={{ textDecoration: "none" }}>
              Connect in this property's Settings → Integrations
            </Link>
          }
        />
      </PageBody>
    );
  }

  const [summary, customers, subscriptions, invoices, charges] = await Promise.all([
    getBillingSummary(orgId, project.id),
    listCustomers(orgId, project.id),
    listSubscriptions(orgId, project.id),
    listInvoices(orgId, project.id),
    listCharges(orgId, project.id),
  ]);

  const customerById = new Map(customers.map((c) => [c.id, c]));

  return (
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
  );
}
