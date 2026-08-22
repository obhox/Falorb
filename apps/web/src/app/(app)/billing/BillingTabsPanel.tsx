"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Card, DataTable, Tabs } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { money, relative, shortDate } from "@/lib/format";

export interface CustomerRow {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  currency: string | null;
  delinquent: boolean | null;
  personId: string | null;
  syncedAt: string;
}

export interface SubscriptionRow {
  id: string;
  customerEmail: string | null;
  status: string;
  amountPerCycle: number;
  currency: string;
  interval: string;
  intervalCount: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

export interface InvoiceRow {
  id: string;
  customerEmail: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  number: string | null;
  hostedInvoiceUrl: string | null;
  dueDate: string | null;
}

export interface ChargeRow {
  id: string;
  customerEmail: string | null;
  status: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  refunded: boolean;
  disputed: boolean;
  failureMessage: string | null;
  receiptUrl: string | null;
  createdAt: string | null;
}

/** Stripe's own status vocabulary, mapped to this design system's badge tones — not re-declared as a schema enum anywhere (see `packages/db/src/schema/billing.ts`). */
const SUBSCRIPTION_TONE: Record<string, "warn" | "neutral" | "up" | "down"> = {
  active: "up",
  trialing: "up",
  past_due: "down",
  unpaid: "down",
  incomplete: "warn",
  incomplete_expired: "down",
  paused: "neutral",
  canceled: "neutral",
};

const INVOICE_TONE: Record<string, "warn" | "neutral" | "up" | "down"> = {
  paid: "up",
  open: "warn",
  draft: "neutral",
  uncollectible: "down",
  void: "neutral",
};

const CHARGE_TONE: Record<string, "warn" | "neutral" | "up" | "down"> = {
  succeeded: "up",
  pending: "warn",
  failed: "down",
};

function fmt(cents: number, currency: string): string {
  return money(cents / 100, currency.toUpperCase());
}

function PersonLink({ personId }: { personId: string | null }) {
  if (!personId) return <>—</>;
  return (
    <Link href={`/people/${personId}`} data-plain style={{ color: "var(--text-primary)" }}>
      view person
    </Link>
  );
}

export function BillingTabsPanel({
  customers,
  subscriptions,
  invoices,
  charges,
  now,
}: {
  customers: CustomerRow[];
  subscriptions: SubscriptionRow[];
  invoices: InvoiceRow[];
  charges: ChargeRow[];
  now: number;
}) {
  const [tab, setTab] = useState("customers");

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "customers", label: "Customers", count: customers.length },
          { value: "subscriptions", label: "Subscriptions", count: subscriptions.length },
          { value: "invoices", label: "Invoices", count: invoices.length },
          { value: "charges", label: "Charges", count: charges.length },
        ]}
      />

      {tab === "customers" && (
        <Card title="Customers" subtitle="Mirrored from Stripe every 15 minutes — read-only">
          <DataTable
            dense
            columns={[
              { key: "email", header: "Email", width: "minmax(160px, 1.6fr)", render: (r: CustomerRow) => r.email ?? "—" },
              { key: "name", header: "Name", width: "minmax(120px, 1fr)", render: (r: CustomerRow) => r.name ?? "—" },
              { key: "phone", header: "Phone", width: "120px", render: (r: CustomerRow) => r.phone ?? "—" },
              {
                key: "delinquent",
                header: "Status",
                width: "100px",
                render: (r: CustomerRow) =>
                  r.delinquent ? <Badge tone="down">delinquent</Badge> : <Badge tone="up">current</Badge>,
              },
              { key: "person", header: "Person", width: "90px", render: (r: CustomerRow) => <PersonLink personId={r.personId} /> },
              {
                key: "syncedAt",
                header: "Synced",
                width: "100px",
                render: (r: CustomerRow) => relative(r.syncedAt, now),
              },
            ]}
            rows={customers}
            emptyState={<Empty dense icon="users" title="No customers yet" body="Nothing has synced yet." />}
          />
        </Card>
      )}

      {tab === "subscriptions" && (
        <Card title="Subscriptions" subtitle="Active subscriptions drive the MRR estimate above">
          <DataTable
            dense
            columns={[
              {
                key: "status",
                header: "Status",
                width: "100px",
                render: (r: SubscriptionRow) => <Badge tone={SUBSCRIPTION_TONE[r.status] ?? "neutral"}>{r.status}</Badge>,
              },
              { key: "customer", header: "Customer", width: "minmax(160px, 1.6fr)", render: (r: SubscriptionRow) => r.customerEmail ?? "—" },
              {
                key: "amount",
                header: "Amount",
                width: "140px",
                render: (r: SubscriptionRow) =>
                  `${fmt(r.amountPerCycle, r.currency)} / ${r.intervalCount > 1 ? `${r.intervalCount} ${r.interval}s` : r.interval}`,
              },
              {
                key: "renews",
                header: "Renews",
                width: "140px",
                render: (r: SubscriptionRow) =>
                  r.cancelAtPeriodEnd
                    ? "cancels at period end"
                    : r.currentPeriodEnd
                      ? shortDate(r.currentPeriodEnd, now)
                      : "—",
              },
            ]}
            rows={subscriptions}
            emptyState={<Empty dense icon="repeat" title="No subscriptions yet" body="Nothing has synced yet." />}
          />
        </Card>
      )}

      {tab === "invoices" && (
        <Card title="Invoices" subtitle="Paid, open, and overdue invoices">
          <DataTable
            dense
            columns={[
              {
                key: "status",
                header: "Status",
                width: "100px",
                render: (r: InvoiceRow) => <Badge tone={INVOICE_TONE[r.status ?? ""] ?? "neutral"}>{r.status ?? "—"}</Badge>,
              },
              { key: "customer", header: "Customer", width: "minmax(160px, 1.6fr)", render: (r: InvoiceRow) => r.customerEmail ?? "—" },
              {
                key: "number",
                header: "Number",
                width: "minmax(100px, 1fr)",
                render: (r: InvoiceRow) =>
                  r.hostedInvoiceUrl ? (
                    <a href={r.hostedInvoiceUrl} target="_blank" rel="noreferrer" data-plain style={{ color: "var(--text-primary)" }}>
                      {r.number ?? "view invoice"}
                    </a>
                  ) : (
                    (r.number ?? "—")
                  ),
              },
              {
                key: "amount",
                header: "Paid / Due",
                width: "140px",
                render: (r: InvoiceRow) => `${fmt(r.amountPaid, r.currency)} / ${fmt(r.amountDue, r.currency)}`,
              },
              { key: "dueDate", header: "Due", width: "100px", render: (r: InvoiceRow) => (r.dueDate ? shortDate(r.dueDate, now) : "—") },
            ]}
            rows={invoices}
            emptyState={<Empty dense icon="file-text" title="No invoices yet" body="Nothing has synced yet." />}
          />
        </Card>
      )}

      {tab === "charges" && (
        <Card title="Charges" subtitle="Recent charges — failures are the payment-health signal this integration exists for">
          <DataTable
            dense
            columns={[
              {
                key: "status",
                header: "Status",
                width: "100px",
                render: (r: ChargeRow) => <Badge tone={CHARGE_TONE[r.status] ?? "neutral"}>{r.status}</Badge>,
              },
              { key: "customer", header: "Customer", width: "minmax(160px, 1.6fr)", render: (r: ChargeRow) => r.customerEmail ?? "—" },
              {
                key: "amount",
                header: "Amount",
                width: "140px",
                render: (r: ChargeRow) =>
                  r.refunded ? `${fmt(r.amount, r.currency)} (refunded)` : fmt(r.amount, r.currency),
              },
              {
                key: "note",
                header: "Note",
                width: "minmax(140px, 1.6fr)",
                render: (r: ChargeRow) => (
                  <span style={{ color: r.status === "failed" ? "var(--signal-down)" : undefined }}>
                    {r.failureMessage ?? (r.disputed ? "disputed" : "—")}
                  </span>
                ),
              },
              { key: "createdAt", header: "Date", width: "100px", render: (r: ChargeRow) => (r.createdAt ? shortDate(r.createdAt, now) : "—") },
            ]}
            rows={charges}
            emptyState={<Empty dense icon="credit-card" title="No charges yet" body="Nothing has synced yet." />}
          />
        </Card>
      )}
    </div>
  );
}
