import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { decryptSecret } from "@falorb/db";
import { schema, type WorkerContext } from "../context";

/**
 * Contact enrichment for discovered prospects, via each organization's own
 * connected Clay account — the per-org counterpart to reddit-listener.ts's
 * platform-wide credential. Same enrichment-cache shape and reasoning as
 * `enrichCompanies`/`resolveAsn`: cache both hits and misses so a prospect is
 * looked up (and billed against the org's Clay credits) at most once.
 *
 * `callClayEnrichment` below is the one place the actual request/response
 * shape lives — isolated deliberately, since a third-party API's exact
 * contract is the piece most likely to need adjusting once tested against a
 * real Clay workspace, while the sweep/caching/error-isolation logic around
 * it should not need to change alongside it.
 */

const REQUEST_TIMEOUT_MS = 8000;
const FAILED_RECHECK_MS = 7 * 86_400_000;
const MAX_PER_ORG_PER_RUN = 25;

interface ClayContact {
  name: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
  companyDomain: string | null;
}

export async function enrichProspectsViaClay(context: WorkerContext): Promise<number> {
  const connections = await context.db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.kind, "clay"), eq(schema.integrations.status, "connected")));

  if (!connections.length) return 0;

  let enriched = 0;
  for (const integration of connections) {
    try {
      enriched += await enrichForOrg(context, integration);
    } catch (error) {
      console.error(`[clay-enrichment] org ${integration.organizationId} failed:`, String(error));
      await context.db
        .update(schema.integrations)
        .set({ status: "error", lastSyncError: String(error), updatedAt: new Date() })
        .where(eq(schema.integrations.id, integration.id));
    }
  }

  if (enriched) console.log(`[clay-enrichment] enriched ${enriched} prospects`);
  return enriched;
}

async function enrichForOrg(
  context: WorkerContext,
  integration: typeof schema.integrations.$inferSelect,
): Promise<number> {
  if (!integration.encryptedCredential) return 0;

  // A bad/rotated key surfaces as a sync error for this org and moves on —
  // it must not abort the sweep for every other connected org.
  const apiKey = decryptSecret(integration.encryptedCredential);

  const [sync] = await context.db
    .insert(schema.integrationSyncs)
    .values({ integrationId: integration.id, status: "running" })
    .returning({ id: schema.integrationSyncs.id });
  if (!sync) return 0;

  const recheckCutoff = new Date(Date.now() - FAILED_RECHECK_MS);
  const candidates = await context.db
    .select()
    .from(schema.prospects)
    .where(
      and(
        eq(schema.prospects.organizationId, integration.organizationId),
        isNull(schema.prospects.enrichedAt),
        sql`${schema.prospects.status} != 'dismissed'`,
        or(
          isNull(schema.prospects.enrichmentFailedAt),
          lt(schema.prospects.enrichmentFailedAt, recheckCutoff),
        ),
      ),
    )
    .limit(MAX_PER_ORG_PER_RUN);

  let enrichedCount = 0;
  let error: string | null = null;

  for (const prospect of candidates) {
    try {
      const contact = await callClayEnrichment(apiKey, {
        name: prospect.authorHandle,
        handle: prospect.authorHandle,
        sourceUrl: prospect.sourceUrl,
      });

      if (contact) {
        await context.db
          .update(schema.prospects)
          .set({
            contactName: contact.name,
            contactEmail: contact.email,
            contactTitle: contact.title,
            contactLinkedinUrl: contact.linkedinUrl,
            contactCompanyDomain: contact.companyDomain,
            enrichmentRaw: contact as unknown as Record<string, unknown>,
            enrichedAt: new Date(),
            // Only advance status if a human hasn't already acted on this
            // prospect while enrichment was in flight.
            status: prospect.status === "new" ? "enriched" : prospect.status,
            updatedAt: new Date(),
          })
          .where(eq(schema.prospects.id, prospect.id));
        enrichedCount++;
      } else {
        await context.db
          .update(schema.prospects)
          .set({ enrichmentFailedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.prospects.id, prospect.id));
      }
    } catch (itemError) {
      console.error(`[clay-enrichment] prospect ${prospect.id} failed:`, String(itemError));
      await context.db
        .update(schema.prospects)
        .set({ enrichmentFailedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.prospects.id, prospect.id));
      error = String(itemError);
    }
  }

  await context.db
    .update(schema.integrationSyncs)
    .set({
      finishedAt: new Date(),
      status: error ? "error" : "success",
      recordsIn: candidates.length,
      recordsOut: enrichedCount,
      error,
    })
    .where(eq(schema.integrationSyncs.id, sync.id));

  await context.db
    .update(schema.integrations)
    .set({ lastSyncAt: new Date(), lastSyncError: null, updatedAt: new Date() })
    .where(eq(schema.integrations.id, integration.id));

  return enrichedCount;
}

/**
 * The isolated Clay API call. Endpoint/payload/response shape should be
 * confirmed against Clay's current API documentation before pointing this at
 * a live workspace — third-party API contracts drift, and this is written
 * against Clay's documented enrichment-request shape rather than a live
 * integration test.
 */
async function callClayEnrichment(
  apiKey: string,
  input: { name: string | null; handle: string | null; sourceUrl: string },
): Promise<ClayContact | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.clay.com/v3/enrich/person", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        social_handle: input.handle,
        source_url: input.sourceUrl,
      }),
    });

    if (response.status === 404) return null; // no match — a real, cacheable miss
    if (!response.ok) throw new Error(`Clay enrichment failed (${response.status})`);

    return parseClayResponse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

interface RawClayResponse {
  name?: string;
  email?: string;
  title?: string;
  linkedin_url?: string;
  company_domain?: string;
}

/** Pulled out of `callClayEnrichment` so the response shape is
 * unit-testable without a network call. */
export function parseClayResponse(body: unknown): ClayContact | null {
  const raw = body as RawClayResponse;
  if (!raw.email && !raw.linkedin_url) return null;

  return {
    name: raw.name ?? null,
    email: raw.email ?? null,
    title: raw.title ?? null,
    linkedinUrl: raw.linkedin_url ?? null,
    companyDomain: raw.company_domain ?? null,
  };
}
