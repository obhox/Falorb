import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, projects } from "./tenancy";
import { persons } from "./persons";

/**
 * A read-only mirror of Stripe (the operator's own payment processing
 * account — the business run *through* Falorb, not Falorb's own SaaS
 * billing for itself), pulled by `apps/worker/src/jobs/stripe-sync.ts`. See
 * FEATURES.md §20.
 *
 * Same conventions as `crm.ts`/`support.ts`: `organizationId` + `stripeId`
 * (Stripe's own id for the row) unique together, so re-syncing is an upsert
 * regardless of pagination order; `syncedAt` is per-row so a stale mirror
 * row is visible as such rather than silently indistinguishable from a
 * fresh one. Status-ish columns (`status` on subscriptions/invoices/charges)
 * are `text`, not a `pgEnum` — Stripe owns that vocabulary and can add a
 * value to it on its own schedule, same reasoning `crmProfiles.status`
 * gives for not being an enum either.
 *
 * All four tables are Falorb-owned mirror data, never written back to
 * Stripe — there is no write path in `@falorb/stripe-client` at all yet
 * (read-only mirror only, see that package's docblock).
 *
 * `projectId` mirrors `integrationConnections`' own org/project split (see
 * `integrations.ts`): null means the row came from the organization's own
 * (org-level) Stripe connection, set means it came from one project's own
 * Stripe connection — a different Stripe account entirely, for an operator
 * running more than one product (each with its own DBA/Stripe account)
 * under one Falorb organization. The partial-unique-index pair below is the
 * same pattern `integration_connections_org_provider_uq` /
 * `integration_connections_project_provider_uq` use, applied to
 * `stripeId` instead of `provider`: it keeps an org-level Stripe account's
 * data and each project-level Stripe account's data from ever colliding on
 * `stripeId`, even in theory, while still allowing the *same* `stripeId` to
 * appear once under the org-level connection and once under a project-level
 * connection (they are genuinely different Stripe objects that merely
 * share an id namespace coincidence — vanishingly unlikely, but the index
 * shape doesn't rule it out).
 */

const orgId = () =>
  uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

/**
 * Null for a row synced from the organization's own Stripe connection, set
 * for a row synced from one project's own Stripe connection. See this
 * file's docblock.
 */
const projectId = () => integer("project_id").references(() => projects.id, { onDelete: "cascade" });

export const stripeCustomers = pgTable(
  "stripe_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: projectId(),
    stripeId: text("stripe_id").notNull(),
    /** The billing↔analytics join point — set once a match is found (email), never inferred silently. Same standard as `crmContacts.personId`. */
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
    email: text("email"),
    name: text("name"),
    phone: text("phone"),
    currency: text("currency"),
    delinquent: boolean("delinquent"),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stripe_customers_org_stripe_uq")
      .on(t.organizationId, t.stripeId)
      .where(sql`${t.projectId} is null`),
    uniqueIndex("stripe_customers_project_stripe_uq")
      .on(t.organizationId, t.projectId, t.stripeId)
      .where(sql`${t.projectId} is not null`),
    index("stripe_customers_org_email_idx").on(t.organizationId, t.email),
    index("stripe_customers_person_idx").on(t.personId),
    index("stripe_customers_project_idx").on(t.projectId),
  ],
);

export const stripeSubscriptions = pgTable(
  "stripe_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: projectId(),
    stripeId: text("stripe_id").notNull(),
    customerStripeId: text("customer_stripe_id").notNull(),
    customerId: uuid("customer_id").references(() => stripeCustomers.id, { onDelete: "cascade" }),
    /** "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused" | "incomplete" | "incomplete_expired" — Stripe's own vocabulary. */
    status: text("status").notNull(),
    /** Sum of every item's `unit_amount * quantity`, in the smallest currency unit — see `@falorb/stripe-client`'s `StripeSubscription` for why this is well-defined per subscription. */
    amountPerCycle: integer("amount_per_cycle").notNull(),
    currency: text("currency").notNull(),
    /** "day" | "week" | "month" | "year" */
    interval: text("interval").notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    /** `amountPerCycle` normalized to a monthly figure, computed once in `@falorb/stripe-client` — what `/billing`'s MRR estimate sums over `status = 'active'` rows. */
    monthlyAmountEstimate: integer("monthly_amount_estimate").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stripe_subscriptions_org_stripe_uq")
      .on(t.organizationId, t.stripeId)
      .where(sql`${t.projectId} is null`),
    uniqueIndex("stripe_subscriptions_project_stripe_uq")
      .on(t.organizationId, t.projectId, t.stripeId)
      .where(sql`${t.projectId} is not null`),
    index("stripe_subscriptions_customer_idx").on(t.customerId),
    index("stripe_subscriptions_org_status_idx").on(t.organizationId, t.status),
    index("stripe_subscriptions_project_idx").on(t.projectId),
  ],
);

export const stripeInvoices = pgTable(
  "stripe_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: projectId(),
    stripeId: text("stripe_id").notNull(),
    customerStripeId: text("customer_stripe_id"),
    customerId: uuid("customer_id").references(() => stripeCustomers.id, { onDelete: "set null" }),
    subscriptionStripeId: text("subscription_stripe_id"),
    subscriptionId: uuid("subscription_id").references(() => stripeSubscriptions.id, { onDelete: "set null" }),
    /** "draft" | "open" | "paid" | "uncollectible" | "void" */
    status: text("status"),
    amountDue: integer("amount_due").notNull(),
    amountPaid: integer("amount_paid").notNull(),
    amountRemaining: integer("amount_remaining").notNull(),
    currency: text("currency").notNull(),
    number: text("number"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdf: text("invoice_pdf"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stripe_invoices_org_stripe_uq")
      .on(t.organizationId, t.stripeId)
      .where(sql`${t.projectId} is null`),
    uniqueIndex("stripe_invoices_project_stripe_uq")
      .on(t.organizationId, t.projectId, t.stripeId)
      .where(sql`${t.projectId} is not null`),
    index("stripe_invoices_customer_idx").on(t.customerId),
    index("stripe_invoices_org_status_idx").on(t.organizationId, t.status),
    index("stripe_invoices_project_idx").on(t.projectId),
  ],
);

export const stripeCharges = pgTable(
  "stripe_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: orgId(),
    projectId: projectId(),
    stripeId: text("stripe_id").notNull(),
    customerStripeId: text("customer_stripe_id"),
    customerId: uuid("customer_id").references(() => stripeCustomers.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    amountRefunded: integer("amount_refunded").notNull().default(0),
    currency: text("currency").notNull(),
    /** "succeeded" | "pending" | "failed" */
    status: text("status").notNull(),
    paid: boolean("paid").notNull().default(false),
    refunded: boolean("refunded").notNull().default(false),
    disputed: boolean("disputed").notNull().default(false),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    description: text("description"),
    receiptUrl: text("receipt_url"),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stripe_charges_org_stripe_uq")
      .on(t.organizationId, t.stripeId)
      .where(sql`${t.projectId} is null`),
    uniqueIndex("stripe_charges_project_stripe_uq")
      .on(t.organizationId, t.projectId, t.stripeId)
      .where(sql`${t.projectId} is not null`),
    index("stripe_charges_customer_idx").on(t.customerId),
    index("stripe_charges_org_status_idx").on(t.organizationId, t.status),
    index("stripe_charges_project_idx").on(t.projectId),
  ],
);
