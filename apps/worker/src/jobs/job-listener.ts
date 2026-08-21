import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, resolveAiCredentials } from "@falorb/db";
import { search, ResearchUnavailableError, type ResearchClients } from "@falorb/research";
import type { WorkerContext } from "../context";
import { buildResearchClients, type ResearchConnectionRow } from "../research-clients";
import { scoreProspectRelevance } from "./prospect-relevance";

/**
 * Job-posting listening, alongside `reddit-listener.ts` and
 * `hackernews-listener.ts` — see `packages/core/src/prospect-sources.ts` for
 * what each source actually is.
 *
 * Genuinely per-organization, unlike Reddit/Hacker News: there is no free
 * public job-board search API, so this reuses each org's own connected
 * Exa/Firecrawl `integrationConnections` (§13's research providers, already
 * used for company research and content drafting) rather than adding a
 * fourth paid integration just for this. An org with neither connected is
 * simply skipped — same "degrades gracefully, zero cost until connected"
 * posture as `clay-enrichment.ts`.
 *
 * No dedicated job-board API means no natural post id to dedup on the way
 * `reddit-listener`/`hackernews-listener` use the platform's own id — the
 * result URL itself is hashed into `sourceId` instead.
 *
 * Deliberately excluded from `verify:jobs`, same reasoning as
 * `clay-enrichment.ts`: a live run spends a connected org's own paid
 * Exa/Firecrawl credits, unlike every job in that runner which only touches
 * Falorb-controlled resources.
 */

const MAX_KEYWORDS_PER_ORG_PER_RUN = 10;
const RESULTS_PER_KEYWORD = 6;
const SEARCH_TIMEOUT_MS = 20_000;

/** Biases Exa/Firecrawl's web search toward job boards via query text —
 * neither client exposes a domain-filter parameter, so this is the
 * lowest-complexity way to scope results without extending either. */
const JOB_BOARD_HINT =
  'hiring job posting (site:linkedin.com/jobs OR site:indeed.com OR site:lever.co ' +
  "OR site:greenhouse.io OR site:ashbyhq.com OR site:workday.com)";

interface ConnectionRow extends ResearchConnectionRow {
  organizationId: string;
}

export async function listenJobs(context: WorkerContext): Promise<number> {
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

  let discovered = 0;
  for (const [organizationId, orgConnections] of byOrg) {
    try {
      discovered += await listenForOrg(context, organizationId, orgConnections);
    } catch (error) {
      console.error(`[job-listener] org ${organizationId} failed:`, String(error));
    }
  }

  if (discovered) console.log(`[job-listener] discovered ${discovered} new prospects`);
  return discovered;
}

async function listenForOrg(
  context: WorkerContext,
  organizationId: string,
  connections: ConnectionRow[],
): Promise<number> {
  const clients = buildResearchClients(connections);

  const keywordRows = await context.db
    .select({
      projectId: schema.prospectKeywords.projectId,
      keyword: schema.prospectKeywords.keyword,
      projectName: schema.projects.name,
      propertySummary: schema.projects.profileSummary,
    })
    .from(schema.prospectKeywords)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.prospectKeywords.projectId))
    .where(
      and(
        eq(schema.prospectKeywords.active, true),
        eq(schema.projects.organizationId, organizationId),
        isNull(schema.projects.archivedAt),
      ),
    )
    .limit(MAX_KEYWORDS_PER_ORG_PER_RUN);

  let newCount = 0;
  for (const row of keywordRows) {
    try {
      newCount += await listenForKeyword(context, organizationId, clients, row);
    } catch (error) {
      console.error(
        `[job-listener] keyword "${row.keyword}" (project ${row.projectId}, org ${organizationId}) failed:`,
        String(error),
      );
    }
  }
  return newCount;
}

async function listenForKeyword(
  context: WorkerContext,
  organizationId: string,
  clients: ResearchClients,
  row: { projectId: number; keyword: string; projectName: string; propertySummary: string | null },
): Promise<number> {
  let results;
  try {
    results = await search(clients, `${row.keyword} ${JOB_BOARD_HINT}`, {
      limit: RESULTS_PER_KEYWORD,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
  } catch (error) {
    // No connection at all, or both providers failed — nothing to do for
    // this org/keyword this run, not an error worth crashing the sweep over.
    if (error instanceof ResearchUnavailableError) return 0;
    throw error;
  }

  // The organization's own AI gateway and model when it has connected one
  // (see `resolveAiCredentials`). Resolved once per keyword rather than per
  // result — it decrypts a stored key, and every result here scores against
  // the same organization.
  const credentials = await resolveAiCredentials(context.db, organizationId, row.projectId);

  let newCount = 0;
  for (const result of results) {
    const excerpt = result.text.slice(0, 1000);
    if (!excerpt) continue;

    const [inserted] = await context.db
      .insert(schema.prospects)
      .values({
        organizationId,
        projectId: row.projectId,
        source: "job_search",
        sourceId: hashUrl(result.url),
        sourceUrl: result.url,
        sourceType: "posting",
        authorHandle: null,
        title: result.title,
        excerpt,
        matchedKeywords: [row.keyword],
        postedAt: null,
        raw: result,
      })
      .onConflictDoNothing({
        target: [schema.prospects.organizationId, schema.prospects.source, schema.prospects.sourceId],
      })
      .returning({ id: schema.prospects.id });

    if (!inserted) continue; // already discovered — dedup hit
    newCount++;

    // A scoring failure must never drop the underlying discovery — the
    // prospect stays with relevanceScore null, still visible on the dashboard.
    try {
      const scored = await scoreProspectRelevance({
        source: "job_search",
        projectName: row.projectName,
        propertySummary: row.propertySummary,
        keyword: row.keyword,
        credentials,
        title: result.title ?? "",
        excerpt,
      });
      if (scored) {
        await context.db
          .update(schema.prospects)
          .set({ relevanceScore: scored.score, relevanceRationale: scored.rationale })
          .where(eq(schema.prospects.id, inserted.id));
      }
    } catch (error) {
      console.error(`[job-listener] relevance scoring failed for ${inserted.id}:`, String(error));
    }
  }

  return newCount;
}

/** No natural post id from a search result the way Reddit/HN give one —
 * the URL itself is the only stable identity, so it's hashed into the
 * `(organizationId, source, sourceId)` dedup key rather than stored raw
 * (`sourceUrl` already carries the full URL). */
export function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 24);
}
