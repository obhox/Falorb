import "server-only";
import { OpenSeoApiError } from "@falorb/openseo-client";
import type {
  OpenSeoBacklinksOverview,
  OpenSeoDomainKeyword,
  OpenSeoDomainOverview,
  OpenSeoGscPerformanceRow,
  OpenSeoRankTrackerEntry,
} from "@falorb/openseo-client";
import { getOpenSeoClient } from "@/server/integrations";

/** Whether this property (or, absent an override, the organization) has an active OpenSEO connection. */
export async function isOpenSeoConnected(organizationId: string, projectId: number): Promise<boolean> {
  return (await getOpenSeoClient(organizationId, projectId)) !== null;
}

export interface SeoSnapshot {
  domain: string;
  overview: OpenSeoDomainOverview | null;
  keywords: OpenSeoDomainKeyword[];
  backlinks: OpenSeoBacklinksOverview | null;
  rankTracker: OpenSeoRankTrackerEntry[];
  gscPerformance: OpenSeoGscPerformanceRow[];
  /** One entry per panel that failed, e.g. "Search Console: no property connected on OpenSEO's side" — surfaced per-panel rather than failing the whole page. */
  errors: string[];
}

/**
 * One property's live SEO snapshot from OpenSEO, called fresh on every page
 * load — not mirrored into Postgres. See `packages/openseo-client`'s doc
 * comment for why this integration has no sync job: rank tracking, domain
 * keywords, and Search Console data are queries about the current state of
 * one domain, not a list of rows Falorb would own a copy of.
 *
 * Each panel is fetched independently and a failure there is collected into
 * `errors` rather than failing the whole snapshot — OpenSEO having rank
 * tracking configured but no Search Console property linked for this domain
 * is an ordinary, expected state, not a bug in this integration.
 */
export async function getSeoSnapshot(
  organizationId: string,
  projectId: number,
  domain: string,
): Promise<SeoSnapshot | null> {
  const client = await getOpenSeoClient(organizationId, projectId);
  if (!client) return null;

  const errors: string[] = [];
  const detail = (label: string, error: unknown): string =>
    `${label}: ${error instanceof OpenSeoApiError || error instanceof Error ? error.message : String(error)}`;

  const [overview, keywords, backlinks, rankTracker, gscPerformance] = await Promise.all([
    client.getDomainOverview(domain).catch((error: unknown) => {
      errors.push(detail("Domain overview", error));
      return null;
    }),
    client.getDomainKeywords(domain, { limit: 25 }).catch((error: unknown) => {
      errors.push(detail("Domain keywords", error));
      return [];
    }),
    client.getBacklinksOverview(domain).catch((error: unknown) => {
      errors.push(detail("Backlinks", error));
      return null;
    }),
    client.getRankTracker(domain).catch((error: unknown) => {
      errors.push(detail("Rank tracker", error));
      return [];
    }),
    client.getGscPerformance(domain).catch((error: unknown) => {
      errors.push(detail("Search Console", error));
      return [];
    }),
  ]);

  return { domain, overview, keywords, backlinks, rankTracker, gscPerformance, errors };
}
