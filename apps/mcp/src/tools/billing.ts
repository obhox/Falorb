import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { schema } from "@falorb/db";
import type { McpContext, Scope } from "../context";
import { resolveProjects } from "../context";
import { ago, failure, money, table, text } from "../format";

/**
 * Billing — a read-only mirror of Stripe (the operator's own payment
 * processing account run *through* Falorb, not Falorb's own SaaS billing for
 * itself), refreshed by `apps/worker/src/jobs/stripe-sync.ts`. See
 * FEATURES.md §20.
 *
 * Every tool takes an optional `project`, with the same either/or semantics
 * as `apps/web/src/server/billing.ts` — not `resolveProjects`' usual
 * "all projects" default. Omitted, a tool reads the organization's own
 * org-level Stripe connection's mirrored rows (`projectId IS NULL`).
 * Passed, it reads that one project's own separate Stripe connection
 * instead (`projectId = <id>`) — a different Stripe account entirely, for
 * an operator running more than one product under one Falorb organization.
 * The two scopes are never combined in one result, matching the partial-
 * unique-index split in `packages/db/src/schema/billing.ts`.
 *
 * Stripe has no write path anywhere in this codebase yet — no refunds, no
 * subscription changes, no invoice creation (`@falorb/stripe-client`'s own
 * docblock) — so every tool here is read-only, same as `apps/web`'s billing
 * pages having no `actions/billing.ts`.
 */
export function registerBillingTools(server: McpServer, ctx: () => McpContext): void {
  function scopedProjectId(scope: Scope, project: string | undefined): number | undefined {
    if (!project) return undefined;
    return resolveProjects(scope, project)[0];
  }

  server.registerTool(
    "get_billing_summary",
    {
      title: "Billing summary",
      description:
        "Customer count, active subscriptions, MRR estimate per currency, open invoices, and " +
        "failed charges in the last 30 days — from the mirrored Stripe account. Omit project for " +
        "the organization's own Stripe connection; pass a project slug for that property's own " +
        "separate Stripe account instead (never combined with the organization's).",
      inputSchema: {
        project: z.string().optional().describe("Project slug — that property's own Stripe connection, if it has one."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      const { db, scope } = ctx();
      try {
        const projectId = scopedProjectId(scope, project);
        const orgId = scope.organizationId;

        const [[customerCount], mrrRows, [openInvoiceCount], [failedChargeCount]] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.stripeCustomers)
            .where(
              and(
                eq(schema.stripeCustomers.organizationId, orgId),
                projectId != null ? eq(schema.stripeCustomers.projectId, projectId) : isNull(schema.stripeCustomers.projectId),
              ),
            ),
          db
            .select({
              currency: schema.stripeSubscriptions.currency,
              activeCount: sql<number>`count(*)::int`,
              mrr: sql<number>`coalesce(sum(${schema.stripeSubscriptions.monthlyAmountEstimate}), 0)::int`,
            })
            .from(schema.stripeSubscriptions)
            .where(
              and(
                eq(schema.stripeSubscriptions.organizationId, orgId),
                projectId != null
                  ? eq(schema.stripeSubscriptions.projectId, projectId)
                  : isNull(schema.stripeSubscriptions.projectId),
                eq(schema.stripeSubscriptions.status, "active"),
              ),
            )
            .groupBy(schema.stripeSubscriptions.currency),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.stripeInvoices)
            .where(
              and(
                eq(schema.stripeInvoices.organizationId, orgId),
                projectId != null ? eq(schema.stripeInvoices.projectId, projectId) : isNull(schema.stripeInvoices.projectId),
                eq(schema.stripeInvoices.status, "open"),
              ),
            ),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.stripeCharges)
            .where(
              and(
                eq(schema.stripeCharges.organizationId, orgId),
                projectId != null ? eq(schema.stripeCharges.projectId, projectId) : isNull(schema.stripeCharges.projectId),
                eq(schema.stripeCharges.status, "failed"),
                gte(schema.stripeCharges.stripeCreatedAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
              ),
            ),
        ]);

        const activeSubscriptions = mrrRows.reduce((sum, r) => sum + r.activeCount, 0);
        const mrrLines = mrrRows.length
          ? mrrRows.map((r) => `- ${money(r.mrr / 100, r.currency.toUpperCase())} / month (${r.currency.toUpperCase()})`).join("\n")
          : "- No active subscriptions.";

        return text(
          [
            `# Billing summary${projectId ? ` — ${scope.projects.find((p) => p.id === projectId)?.slug ?? projectId}` : " — organization"}`,
            "",
            `Customers: **${customerCount?.count ?? 0}**  ·  Active subscriptions: **${activeSubscriptions}**  ·  Open invoices: **${openInvoiceCount?.count ?? 0}**  ·  Failed charges (30d): **${failedChargeCount?.count ?? 0}**`,
            "",
            "## MRR estimate",
            mrrLines,
            "",
            "Not connected, or never synced? This still returns zeros rather than an error — check " +
              "get_integration_status for provider \"stripe\" before trusting an all-zero summary.",
          ].join("\n"),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_billing_customers",
    {
      title: "List billing customers",
      description:
        "Customers mirrored from Stripe, most recently synced first. Optionally filtered by an " +
        "email or name fragment. A customer's linked Falorb person (matched by email) is shown " +
        "when one has been found.",
      inputSchema: {
        project: z.string().optional().describe("Project slug — that property's own Stripe connection, if it has one."),
        search: z.string().optional().describe("Match against email or name."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, search, limit }) => {
      const { db, scope } = ctx();
      try {
        const projectId = scopedProjectId(scope, project);
        const rows = await db
          .select()
          .from(schema.stripeCustomers)
          .where(
            and(
              eq(schema.stripeCustomers.organizationId, scope.organizationId),
              projectId != null ? eq(schema.stripeCustomers.projectId, projectId) : isNull(schema.stripeCustomers.projectId),
            ),
          )
          .orderBy(desc(schema.stripeCustomers.syncedAt))
          .limit(search ? 500 : limit);

        const filtered = search
          ? rows
              .filter((r) => [r.email, r.name].some((v) => (v ?? "").toLowerCase().includes(search.toLowerCase())))
              .slice(0, limit)
          : rows;

        return text(
          table(
            filtered,
            [
              { header: "Stripe id", get: (r) => r.stripeId },
              { header: "Name", get: (r) => r.name },
              { header: "Email", get: (r) => r.email },
              { header: "Currency", get: (r) => r.currency?.toUpperCase() },
              { header: "Delinquent", get: (r) => (r.delinquent ? "yes" : "no") },
              { header: "Linked person", get: (r) => r.personId },
              { header: "Synced", get: (r) => ago(r.syncedAt.toISOString()) },
            ],
            "No customers mirrored yet — Stripe may not be connected for this scope, or has never synced.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_billing_subscriptions",
    {
      title: "List billing subscriptions",
      description:
        "Subscriptions mirrored from Stripe. Active by default; pass status to see another state " +
        "(\"trialing\", \"past_due\", \"canceled\", \"unpaid\", \"paused\", \"incomplete\", " +
        "\"incomplete_expired\") or \"all\" for every state.",
      inputSchema: {
        project: z.string().optional().describe("Project slug — that property's own Stripe connection, if it has one."),
        status: z.string().default("active").describe('Stripe\'s status string, or "all".'),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, status, limit }) => {
      const { db, scope } = ctx();
      try {
        const projectId = scopedProjectId(scope, project);
        const conditions = [
          eq(schema.stripeSubscriptions.organizationId, scope.organizationId),
          projectId != null ? eq(schema.stripeSubscriptions.projectId, projectId) : isNull(schema.stripeSubscriptions.projectId),
        ];
        if (status.toLowerCase() !== "all") conditions.push(eq(schema.stripeSubscriptions.status, status));

        const rows = await db
          .select()
          .from(schema.stripeSubscriptions)
          .where(and(...conditions))
          .orderBy(desc(schema.stripeSubscriptions.stripeCreatedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Stripe id", get: (r) => r.stripeId },
              { header: "Customer", get: (r) => r.customerStripeId },
              { header: "Status", get: (r) => r.status },
              { header: "Per cycle", get: (r) => `${money(r.amountPerCycle / 100, r.currency.toUpperCase())} / ${r.intervalCount > 1 ? `${r.intervalCount} ` : ""}${r.interval}` },
              { header: "MRR est.", get: (r) => money(r.monthlyAmountEstimate / 100, r.currency.toUpperCase()) },
              { header: "Cancels at period end", get: (r) => (r.cancelAtPeriodEnd ? "yes" : "no") },
              { header: "Period ends", get: (r) => (r.currentPeriodEnd ? r.currentPeriodEnd.toISOString().slice(0, 10) : "—") },
              { header: "Synced", get: (r) => ago(r.syncedAt.toISOString()) },
            ],
            "No subscriptions mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_billing_invoices",
    {
      title: "List billing invoices",
      description:
        "Invoices mirrored from Stripe, newest first. Optionally filtered by status " +
        "(\"draft\", \"open\", \"paid\", \"uncollectible\", \"void\").",
      inputSchema: {
        project: z.string().optional().describe("Project slug — that property's own Stripe connection, if it has one."),
        status: z.string().optional().describe("Stripe's status string. Omit for every status."),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, status, limit }) => {
      const { db, scope } = ctx();
      try {
        const projectId = scopedProjectId(scope, project);
        const conditions = [
          eq(schema.stripeInvoices.organizationId, scope.organizationId),
          projectId != null ? eq(schema.stripeInvoices.projectId, projectId) : isNull(schema.stripeInvoices.projectId),
        ];
        if (status) conditions.push(eq(schema.stripeInvoices.status, status));

        const rows = await db
          .select()
          .from(schema.stripeInvoices)
          .where(and(...conditions))
          .orderBy(desc(schema.stripeInvoices.stripeCreatedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Number", get: (r) => r.number ?? r.stripeId },
              { header: "Customer", get: (r) => r.customerStripeId },
              { header: "Status", get: (r) => r.status },
              { header: "Due", get: (r) => money(r.amountDue / 100, r.currency.toUpperCase()) },
              { header: "Paid", get: (r) => money(r.amountPaid / 100, r.currency.toUpperCase()) },
              { header: "Due date", get: (r) => (r.dueDate ? r.dueDate.toISOString().slice(0, 10) : "—") },
              { header: "Paid at", get: (r) => (r.paidAt ? ago(r.paidAt.toISOString()) : "—") },
              { header: "Hosted URL", get: (r) => r.hostedInvoiceUrl },
            ],
            "No invoices mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_billing_charges",
    {
      title: "List billing charges",
      description:
        "Charges mirrored from Stripe, newest first. Optionally filtered by status " +
        "(\"succeeded\", \"pending\", \"failed\") — pass \"failed\" to see payment-health problems.",
      inputSchema: {
        project: z.string().optional().describe("Project slug — that property's own Stripe connection, if it has one."),
        status: z.string().optional().describe("Stripe's status string. Omit for every status."),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, status, limit }) => {
      const { db, scope } = ctx();
      try {
        const projectId = scopedProjectId(scope, project);
        const conditions = [
          eq(schema.stripeCharges.organizationId, scope.organizationId),
          projectId != null ? eq(schema.stripeCharges.projectId, projectId) : isNull(schema.stripeCharges.projectId),
        ];
        if (status) conditions.push(eq(schema.stripeCharges.status, status));

        const rows = await db
          .select()
          .from(schema.stripeCharges)
          .where(and(...conditions))
          .orderBy(desc(schema.stripeCharges.stripeCreatedAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Stripe id", get: (r) => r.stripeId },
              { header: "Customer", get: (r) => r.customerStripeId },
              { header: "Amount", get: (r) => money(r.amount / 100, r.currency.toUpperCase()) },
              { header: "Refunded", get: (r) => (r.amountRefunded ? money(r.amountRefunded / 100, r.currency.toUpperCase()) : "—") },
              { header: "Status", get: (r) => r.status },
              { header: "Disputed", get: (r) => (r.disputed ? "yes" : "no") },
              { header: "Failure", get: (r) => r.failureMessage ?? r.failureCode },
              { header: "Created", get: (r) => (r.stripeCreatedAt ? ago(r.stripeCreatedAt.toISOString()) : "—") },
            ],
            "No charges mirrored yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
