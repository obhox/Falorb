import { FirecrawlApiError, type FirecrawlClient } from "./firecrawl";

/**
 * Firecrawl is the one web-research provider. `search`/`fetchPage` throw
 * `ResearchUnavailableError` when it is unconnected or its request fails,
 * so a feature can degrade gracefully in one place instead of every caller
 * re-deriving "research didn't work."
 *
 * It is a per-organization connection (`integrationConnections`), the same
 * as Linki/Bund AI — there is no platform-wide key. A caller builds
 * `ResearchClients` from the calling organization's own connections
 * (`apps/web/src/server/integrations.ts`'s `getResearchClients`) and passes
 * it in; a `null` client here just means that organization hasn't connected
 * it.
 */
export class ResearchUnavailableError extends Error {}

export interface ResearchClients {
  firecrawl: FirecrawlClient | null;
}

export interface ResearchResult {
  provider: "firecrawl";
  title: string | null;
  url: string;
  text: string;
}

export interface SearchOptions {
  /** Defaults to 5. */
  limit?: number;
  timeoutMs?: number;
}

/** Search the web for a query — each result scraped to markdown. */
export async function search(clients: ResearchClients, query: string, opts: SearchOptions = {}): Promise<ResearchResult[]> {
  if (clients.firecrawl) {
    try {
      const results = await clients.firecrawl.search(query, { limit: opts.limit, timeoutMs: opts.timeoutMs });
      return results.map((r) => ({ provider: "firecrawl" as const, title: r.title, url: r.url, text: r.markdown }));
    } catch (error) {
      if (!(error instanceof FirecrawlApiError)) throw error;
    }
  }

  throw new ResearchUnavailableError(
    "Web search is unavailable — connect Firecrawl in Settings → Integrations (or check why it failed).",
  );
}

/**
 * Fetch one already-known URL's content — a real scrape, handling
 * JS-rendered pages and returning clean markdown.
 */
export async function fetchPage(
  clients: ResearchClients,
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<ResearchResult> {
  if (clients.firecrawl) {
    try {
      const page = await clients.firecrawl.scrapeUrl(url, { timeoutMs: opts.timeoutMs });
      return { provider: "firecrawl", title: page.title, url: page.url, text: page.markdown };
    } catch (error) {
      if (!(error instanceof FirecrawlApiError)) throw error;
    }
  }

  throw new ResearchUnavailableError(
    "Web content fetch is unavailable — connect Firecrawl in Settings → Integrations (or check why it failed).",
  );
}
