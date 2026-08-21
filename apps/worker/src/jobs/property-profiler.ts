import { and, eq, inArray, isNull } from "drizzle-orm";
import { resolveAiCredentials, schema } from "@falorb/db";
import { researchProperty, PropertyResearchError } from "@falorb/research";
import type { WorkerContext } from "../context";
import { buildResearchClients } from "../research-clients";

/**
 * Crawls each property's own homepage into `projects.profile*` — what the
 * product does, who it's for, and what's worth listening for — so
 * `reddit-listener.ts`/`hackernews-listener.ts`/`job-listener.ts` have more
 * to reason with than a bare project name, and so `draft_prospect_outreach`
 * can ground a message in what's actually being sold. See
 * `packages/research/src/property-profile.ts` for the crawl-and-summarize
 * logic itself, shared with the manual "Re-crawl" settings action
 * (`apps/web/src/server/actions/property-profile.ts`).
 *
 * Per-organization like `job-listener.ts`, for the same reason: it needs an
 * org's own connected Exa/Firecrawl provider, and an org with neither
 * connected is simply skipped.
 *
 * Picks up a project two ways: `profileCrawledAt` is null (never crawled —
 * covers onboarding, since a new project starts with every profile column
 * empty) or older than `RECRAWL_INTERVAL_MS` (the product may have changed
 * its homepage since). `profileCrawlFailedAt` gets the same negative-result
 * caching as `enrichCompanies`/`enrichProspectsViaClay` so a project with an
 * unreachable domain isn't re-attempted every run.
 *
 * Deliberately excluded from `verify:jobs`, same reasoning as
 * `job-listener.ts`/`clay-enrichment.ts`: a live run spends a connected
 * org's own paid Exa/Firecrawl credits.
 */

const RECRAWL_INTERVAL_MS = 30 * 86_400_000;
const FAILED_RECHECK_MS = 7 * 86_400_000;
const MAX_PROJECTS_PER_ORG_PER_RUN = 5;

interface ConnectionRow {
  organizationId: string;
  provider: string;
  baseUrl: string;
  encryptedApiKey: string;
  iv: string;
  authTag: string;
}

export async function profileProperties(context: WorkerContext): Promise<number> {
  const connections = await context.db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        inArray(schema.integrationConnections.provider, ["exa", "firecrawl"]),
        eq(schema.integrationConnections.status, "active"),
      ),
    );

  if (!connections.length) return 0;

  const byOrg = new Map<string, ConnectionRow[]>();
  for (const connection of connections) {
    const list = byOrg.get(connection.organizationId) ?? [];
    list.push(connection);
    byOrg.set(connection.organizationId, list);
  }

  let profiled = 0;
  for (const [organizationId, orgConnections] of byOrg) {
    try {
      profiled += await profileForOrg(context, organizationId, orgConnections);
    } catch (error) {
      console.error(`[property-profiler] org ${organizationId} failed:`, String(error));
    }
  }

  if (profiled) console.log(`[property-profiler] crawled ${profiled} properties`);
  return profiled;
}

async function profileForOrg(
  context: WorkerContext,
  organizationId: string,
  connections: ConnectionRow[],
): Promise<number> {
  const clients = buildResearchClients(connections);
  // Resolved once per org rather than per property: it decrypts a stored
  // key, and every property in this loop bills the same organization.
  const credentials = await resolveAiCredentials(context.db, organizationId);

  const staleCutoff = new Date(Date.now() - RECRAWL_INTERVAL_MS);
  const recheckCutoff = new Date(Date.now() - FAILED_RECHECK_MS);

  const orgProjects = await context.db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.organizationId, organizationId), isNull(schema.projects.archivedAt)));

  const candidates = orgProjects
    .filter((p) => p.domains.length > 0)
    .filter((p) => !p.profileCrawledAt || p.profileCrawledAt < staleCutoff)
    .filter((p) => !p.profileCrawlFailedAt || p.profileCrawlFailedAt < recheckCutoff)
    .slice(0, MAX_PROJECTS_PER_ORG_PER_RUN);

  let count = 0;
  for (const project of candidates) {
    const domain = project.domains[0]!;
    try {
      const result = await researchProperty(clients, project.name, domain, credentials);
      await context.db
        .update(schema.projects)
        .set({
          profileSummary: result.summary,
          profileIcp: result.icp,
          profileKeyFeatures: result.keyFeatures,
          profileSuggestedKeywords: result.suggestedKeywords,
          profileRaw: result as unknown as Record<string, unknown>,
          profileCrawledAt: new Date(),
          profileCrawlFailedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.projects.id, project.id));
      count++;
    } catch (error) {
      const detail = error instanceof PropertyResearchError ? error.message : String(error);
      console.error(`[property-profiler] project ${project.id} (${domain}) failed:`, detail);
      await context.db
        .update(schema.projects)
        .set({ profileCrawlFailedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.projects.id, project.id));
    }
  }

  return count;
}
