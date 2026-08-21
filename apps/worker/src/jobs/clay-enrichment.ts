import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { decryptCredential, schema } from "@falorb/db";
import { ClayClient } from "@falorb/clay-client";
import type { WorkerContext } from "../context";

/**
 * Contact enrichment for discovered prospects, via each organization's own
 * connected Clay account — the per-org counterpart to reddit-listener.ts's
 * platform-wide credential, and Clay's counterpart to `linki-sync.ts`. Reuses
 * the shared `integrationConnections` table (§13/FEATURES.md) rather than a
 * prospecting-specific one — the same table already holds Linki/Bund AI
 * credentials, and Clay's needs (org-scoped, encrypted, a status a sync job
 * can check) are identical.
 *
 * Same enrichment-cache shape and reasoning as `enrichCompanies`/`resolveAsn`:
 * cache both hits and misses so a prospect is looked up (and billed against
 * the org's Clay credits) at most once.
 */

const FAILED_RECHECK_MS = 7 * 86_400_000;
const MAX_PER_ORG_PER_RUN = 25;

export async function enrichProspectsViaClay(context: WorkerContext): Promise<number> {
  // Org-level connections only — same reasoning as `linki-sync.ts`: a
  // property's own override is used on demand, not swept by this job.
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "clay"),
        eq(schema.integrationConnections.status, "active"),
      ),
    );

  if (!connections.length) return 0;

  let enriched = 0;
  for (const connection of connections) {
    try {
      enriched += await enrichForOrg(context, connection);
    } catch (error) {
      console.error(`[clay-enrichment] org ${connection.organizationId} failed:`, String(error));
      await context.db
        .update(schema.integrationConnections)
        .set({ status: "error", lastError: String(error), updatedAt: new Date() })
        .where(eq(schema.integrationConnections.id, connection.id));
    }
  }

  if (enriched) console.log(`[clay-enrichment] enriched ${enriched} prospects`);
  return enriched;
}

async function enrichForOrg(
  context: WorkerContext,
  connection: typeof schema.integrationConnections.$inferSelect,
): Promise<number> {
  // A bad/rotated key surfaces as a connection error for this org and moves
  // on — it must not abort the sweep for every other connected org.
  const apiKey = decryptCredential({
    ciphertext: connection.encryptedApiKey,
    iv: connection.iv,
    authTag: connection.authTag,
  });
  const client = new ClayClient({ baseUrl: connection.baseUrl, apiKey });

  const recheckCutoff = new Date(Date.now() - FAILED_RECHECK_MS);
  const candidates = await context.db
    .select()
    .from(schema.prospects)
    .where(
      and(
        eq(schema.prospects.organizationId, connection.organizationId),
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
  let lastError: string | null = null;

  for (const prospect of candidates) {
    try {
      const contact = await client.enrichPerson({
        name: prospect.authorHandle,
        socialHandle: prospect.authorHandle,
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
      lastError = String(itemError);
    }
  }

  // Sync health lives on the connection row itself (`lastSyncedAt`/`lastError`)
  // — same convention `linki-sync`/`bund-ai-sync` use — rather than a
  // separate run-history table.
  await context.db
    .update(schema.integrationConnections)
    .set({
      lastSyncedAt: new Date(),
      status: lastError ? "error" : "active",
      lastError,
      updatedAt: new Date(),
    })
    .where(eq(schema.integrationConnections.id, connection.id));

  return enrichedCount;
}
