import Stripe from "stripe";

/**
 * Typed client for the Stripe endpoints Falorb's billing mirror needs
 * (`apps/worker/src/jobs/stripe-sync.ts`, FEATURES.md §20): customers,
 * subscriptions, invoices, and charges, read-only. Connected per-organization
 * through `integrationConnections` (`provider: "stripe"`), the same shape as
 * Linki/Bund AI/Buffer/Clay/ElevenLabs — each org brings its own Stripe
 * *secret key* for its own account (the business the org runs through
 * Falorb), not Falorb's own SaaS billing for itself.
 *
 * Unlike every other client in this repo, this one wraps Stripe's own
 * `stripe` npm package rather than hand-rolling `fetch` — Stripe's official
 * SDK already handles retries, idempotency keys, and its own typed error
 * hierarchy correctly, and re-deriving that by hand would just be a worse
 * copy of it. What stays consistent with the rest of the repo is the
 * *exported* surface: every public method here returns a plain, flat object
 * (`StripeCustomer`, `StripeSubscription`, …) defined in this file, never a
 * raw `Stripe.Customer`/`Stripe.Subscription` from the SDK — so `stripe` is a
 * dependency of this package alone, and nothing downstream (the sync job,
 * the API route, the dashboard) needs to know the SDK's types to consume it.
 * Same reasoning `ClayClient`'s docblock gives for its own normalized
 * response shape.
 *
 * The API version is pinned explicitly (`STRIPE_API_VERSION` below) rather
 * than left to the SDK's bundled default, per Stripe's own versioning
 * guidance — a request always gets the shape this client was written
 * against, even after `stripe` itself is upgraded later. It currently
 * matches the SDK's own bundled default (`Stripe.LatestApiVersion` as of
 * `stripe@22.5.0`, checked against the live npm registry in August 2026), so
 * pinning it changes nothing about *this* client's behavior today — it only
 * stops a future `stripe` upgrade from silently changing the wire version
 * this client speaks.
 *
 * This is a **read-only mirror**. Nothing here creates, updates, refunds, or
 * cancels anything — no `POST`/write call exists in this file on purpose,
 * matching this repo's "manual action ships after the read mirror is
 * proven" discipline (FEATURES.md §13). When a write action is added later,
 * it must pass an idempotency key (`{ idempotencyKey }` request option) on
 * every mutating call, per Stripe's own integration guidance — there is
 * nothing to key yet because there is nothing that mutates yet.
 *
 * Written against Stripe's published API reference (docs.stripe.com/api),
 * not confirmed against a live account — this repo has no Stripe key to test
 * with. See FEATURES.md §20 for the same live-verification caveat
 * `packages/buffer-client` and the Ramp Router/Gemini AI gateways carried
 * until a real key settled them.
 */

/** Bumping this is a deliberate, reviewed decision — see the module docblock. */
const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2026-07-29.dahlia";

/** Stripe's fixed API root — used when no per-connection override is stored, same convention as `CLAY_DEFAULT_BASE_URL`/`ELEVENLABS_DEFAULT_BASE_URL`. */
export const STRIPE_DEFAULT_BASE_URL = "https://api.stripe.com";

/** One page per outbound request; every `list*` method below cursor-walks internally until Stripe reports no more pages, so a caller always gets the full set — same convention as `BufferClient.listPosts`. */
const PAGE_SIZE = 100;

export interface StripeClientOptions {
  /** Constructor argument for symmetry with every other client in this repo and for testability; Stripe has one fixed API root in practice (`STRIPE_DEFAULT_BASE_URL`), so the connect form never asks for it. */
  baseUrl: string;
  /** A Stripe **secret key** (`sk_live_…`/`sk_test_…`) or restricted key scoped to read Balance, Customers, Subscriptions, Invoices, and Charges — never a publishable key (`pk_…`), which cannot authenticate any of these calls. */
  apiKey: string;
  timeoutMs?: number;
}

export interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  currency: string | null;
  delinquent: boolean | null;
  createdAt: Date;
}

export interface StripeSubscription {
  id: string;
  customerId: string;
  /** "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused" | "incomplete" | "incomplete_expired" — Stripe's own vocabulary, passed through as text rather than re-declared as an enum here. */
  status: string;
  /** Sum of `unit_amount * quantity` across every subscription item, in the smallest currency unit — what the customer is actually billed once per `interval`. Every item in one subscription shares the same billing cycle, so this is well-defined even when a subscription has several line items. */
  amountPerCycle: number;
  currency: string;
  /** "day" | "week" | "month" | "year" */
  interval: string;
  intervalCount: number;
  /** `amountPerCycle` normalized to a monthly figure — `amountPerCycle` as-is for a monthly subscription, divided by 12 for yearly, and so on. This is what the dashboard sums for an MRR estimate, computed once here rather than re-derived from `interval`/`intervalCount` at every read. */
  monthlyAmountEstimate: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
}

export interface StripeInvoice {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  /** "draft" | "open" | "paid" | "uncollectible" | "void" */
  status: string | null;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  currency: string;
  number: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  dueDate: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface StripeCharge {
  id: string;
  customerId: string | null;
  amount: number;
  amountRefunded: number;
  currency: string;
  /** "succeeded" | "pending" | "failed" */
  status: string;
  paid: boolean;
  refunded: boolean;
  disputed: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  description: string | null;
  receiptUrl: string | null;
  createdAt: Date;
}

function toDate(epochSeconds: number | null | undefined): Date | null {
  return typeof epochSeconds === "number" ? new Date(epochSeconds * 1000) : null;
}

function detail(error: Stripe.errors.StripeError): string {
  return error.message ? ` ${error.message}` : "";
}

/**
 * Same per-status mapping style as `packages/ai/src/transport.ts`'s
 * `describeFailure` — a status code alone is not a debugging session.
 * Dispatches on `instanceof` against the SDK's own error subclasses rather
 * than `error.type`: `type` on `StripeError` carries Stripe's *raw API*
 * error type string (`"authentication_error"`, `"invalid_request_error"`,
 * …), not the SDK's class name, so a class-name switch on it would never
 * match. Exported so `index.test.ts` can check each mapping without a
 * network call, same reasoning `ClayClient`'s `parseEnrichmentResponse` is
 * exported for.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    return `Stripe rejected the API key (401)${detail(error)} — check it is a secret key (sk_…), not a publishable key.`;
  }
  if (error instanceof Stripe.errors.StripePermissionError) {
    return `Stripe rejected the request: this key is missing a required permission (403)${detail(error)} — a restricted key needs read access to Balance, Customers, Subscriptions, Invoices and Charges.`;
  }
  if (error instanceof Stripe.errors.StripeRateLimitError) {
    return `Stripe rate-limited the request (429)${detail(error)}`;
  }
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return `Stripe rejected the request as invalid (${error.statusCode ?? 400})${detail(error)}`;
  }
  if (error instanceof Stripe.errors.StripeConnectionError) {
    return `Could not reach Stripe's API${detail(error)}`;
  }
  if (error instanceof Stripe.errors.StripeAPIError) {
    return `Stripe had an internal error (${error.statusCode ?? 500})${detail(error)}`;
  }
  if (error instanceof Stripe.errors.StripeError) {
    return `Stripe returned an error${error.statusCode ? ` (${error.statusCode})` : ""}${detail(error)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Wraps a raw SDK call so every thrown error reaching a caller of this
 * client is a plain `Error` with `describeFailure`'s message — a sync job's
 * `catch (error) { String(error) }` (see `linki-sync.ts`) then already reads
 * clearly, with no need to know about `Stripe.errors.StripeError` itself. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new Error(describeFailure(error));
  }
}

export class StripeClient {
  private raw: Stripe;

  constructor(opts: StripeClientOptions) {
    this.raw = new Stripe(opts.apiKey, {
      apiVersion: STRIPE_API_VERSION,
      timeout: opts.timeoutMs ?? 20_000,
      // `opts.baseUrl` is only ever `STRIPE_DEFAULT_BASE_URL` in practice
      // (see the field's own doc comment) — passed through anyway so a test
      // double or a future Stripe API proxy can override it without a code
      // change here.
      host: new URL(opts.baseUrl).host,
      maxNetworkRetries: 2,
    });
  }

  /**
   * The cheapest authenticated, read-only, key-scoped call Stripe exposes:
   * `GET /v1/balance` costs nothing, requires no specific resource
   * permission beyond the default, 401s on a bad key, and — deliberately —
   * this method never puts the returned balance figures in `detail`, only
   * whether the key is live- or test-mode. A connection test result can end
   * up in logs and audit metadata (`apps/api/src/routes/integrations.ts`),
   * and a real account balance has no business being there.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const balance = await this.raw.balance.retrieve();
      return {
        ok: true,
        detail: `Stripe reachable and key accepted (${balance.livemode ? "live" : "test"} mode).`,
      };
    } catch (error) {
      return { ok: false, detail: describeFailure(error) };
    }
  }

  async listCustomers(): Promise<StripeCustomer[]> {
    const raw = await this.paginateAll((params) => this.raw.customers.list(params));
    return raw.map((c) => ({
      id: c.id,
      email: c.email ?? null,
      name: c.name ?? null,
      phone: c.phone ?? null,
      currency: c.currency ?? null,
      delinquent: c.delinquent ?? null,
      createdAt: toDate(c.created)!,
    }));
  }

  async listSubscriptions(): Promise<StripeSubscription[]> {
    const raw = await this.paginateAll((params) =>
      this.raw.subscriptions.list({ ...params, status: "all" }),
    );
    return raw.map((s) => {
      const items = s.items.data;
      const amountPerCycle = items.reduce(
        (sum, item) => sum + (item.price?.unit_amount ?? 0) * (item.quantity ?? 1),
        0,
      );
      const currency = items[0]?.price?.currency ?? "usd";
      const interval = items[0]?.price?.recurring?.interval ?? "month";
      const intervalCount = items[0]?.price?.recurring?.interval_count ?? 1;
      return {
        id: s.id,
        customerId: typeof s.customer === "string" ? s.customer : s.customer.id,
        status: s.status,
        amountPerCycle,
        currency,
        interval,
        intervalCount,
        monthlyAmountEstimate: monthlyEquivalent(amountPerCycle, interval, intervalCount),
        cancelAtPeriodEnd: s.cancel_at_period_end,
        currentPeriodStart: toDate(items[0]?.current_period_start ?? null),
        currentPeriodEnd: toDate(items[0]?.current_period_end ?? null),
        canceledAt: toDate(s.canceled_at),
        createdAt: toDate(s.created)!,
      };
    });
  }

  async listInvoices(): Promise<StripeInvoice[]> {
    const raw = await this.paginateAll((params) => this.raw.invoices.list(params));
    return raw.map((i) => ({
      id: i.id!,
      customerId: typeof i.customer === "string" ? i.customer : (i.customer?.id ?? ""),
      subscriptionId:
        typeof i.parent?.subscription_details?.subscription === "string"
          ? i.parent.subscription_details.subscription
          : (i.parent?.subscription_details?.subscription?.id ?? null),
      status: i.status,
      amountDue: i.amount_due,
      amountPaid: i.amount_paid,
      amountRemaining: i.amount_remaining,
      currency: i.currency,
      number: i.number,
      hostedInvoiceUrl: i.hosted_invoice_url ?? null,
      invoicePdf: i.invoice_pdf ?? null,
      dueDate: toDate(i.due_date),
      paidAt: toDate(i.status_transitions?.paid_at ?? null),
      createdAt: toDate(i.created)!,
    }));
  }

  async listCharges(): Promise<StripeCharge[]> {
    const raw = await this.paginateAll((params) => this.raw.charges.list(params));
    return raw.map((c) => ({
      id: c.id,
      customerId: c.customer ? (typeof c.customer === "string" ? c.customer : c.customer.id) : null,
      amount: c.amount,
      amountRefunded: c.amount_refunded,
      currency: c.currency,
      status: c.status,
      paid: c.paid,
      refunded: c.refunded,
      disputed: c.disputed,
      failureCode: c.failure_code ?? null,
      failureMessage: c.failure_message ?? null,
      description: c.description,
      receiptUrl: c.receipt_url ?? null,
      createdAt: toDate(c.created)!,
    }));
  }

  /**
   * Cursor-walks a Stripe list endpoint (`starting_after`, `has_more`) until
   * exhausted and returns every row — the sync job (`stripe-sync.ts`) never
   * drives pages itself, same division of responsibility
   * `BufferClient.listPosts` uses for Buffer's Relay cursor pagination.
   */
  private async paginateAll<T extends { id: string }>(
    list: (params: { limit: number; starting_after?: string }) => Promise<Stripe.ApiList<T>>,
  ): Promise<T[]> {
    return call(async () => {
      const all: T[] = [];
      let startingAfter: string | undefined;
      for (;;) {
        const page = await list({ limit: PAGE_SIZE, starting_after: startingAfter });
        all.push(...page.data);
        if (!page.has_more || page.data.length === 0) break;
        startingAfter = page.data[page.data.length - 1]!.id;
      }
      return all;
    });
  }
}

/** Normalizes a per-cycle amount to a monthly figure for MRR rollups — the
 * only two intervals Stripe Billing actually offers beyond day/week are
 * month and year, but all four are handled since the API allows them.
 * Exported for `index.test.ts`, same reasoning as `describeFailure` above. */
export function monthlyEquivalent(amountPerCycle: number, interval: string, intervalCount: number): number {
  const count = intervalCount || 1;
  switch (interval) {
    case "year":
      return amountPerCycle / (12 * count);
    case "week":
      return (amountPerCycle * 52) / (12 * count);
    case "day":
      return (amountPerCycle * 365) / (12 * count);
    case "month":
    default:
      return amountPerCycle / count;
  }
}
