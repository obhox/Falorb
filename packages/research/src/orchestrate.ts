import { ExaApiError, type ExaClient } from "./exa";
import { FirecrawlApiError, type FirecrawlClient } from "./firecrawl";

/**
 * Exa and Firecrawl are fallbacks for each other, never called together for
 * the same request — each of `search` and `fetchPage` below tries exactly
 * one connected provider, and only reaches for the other if the first has
 * no connection or its request itself fails (an
 * `ExaApiError`/`FirecrawlApiError`, not a caller bug). Thrown when *both*
 * are unavailable, so a feature can degrade gracefully in one place instead
 * of every caller re-deriving "neither worked."
 *
 * Both are per-organization connections (`integrationConnections`), the
 * same as Linki/Bund AI/Clay — there is no platform-wide key. A caller
 * builds `ResearchClients` from the calling organization's own connections
 * (`apps/web/src/server/integrations.ts`'s `getResearchClients`) and passes
 * it in; a `null` client here just means that organization hasn't connected
 * that provider.
 */
export class ResearchUnavailableError extends Error {}

export interface ResearchClients {
  exa: ExaClient | null;
  firecrawl: FirecrawlClient | null;
}

export interface ResearchResult {
  provider: "exa" | "firecrawl";
  title: string | null;
  url: string;
  text: string;
}

export interface SearchOptions {
  /** Defaults to 5. */
  limit?: number;
  timeoutMs?: number;
}

/**
 * Search the web for a query. Exa is the primary provider — it is built for
 * this and returns extracted text inline. Firecrawl's own search endpoint
 * (each result scraped to markdown) runs only as a fallback, when the
 * organization has no Exa connection or Exa's request fails.
 */
export async function search(clients: ResearchClients, query: string, opts: SearchOptions = {}): Promise<ResearchResult[]> {
  if (clients.exa) {
    try {
      const results = await clients.exa.search(query, { numResults: opts.limit, timeoutMs: opts.timeoutMs });
      return results
        .filter((r) => r.text)
        .map((r) => ({ provider: "exa" as const, title: r.title, url: r.url, text: r.text! }));
    } catch (error) {
      if (!(error instanceof ExaApiError)) throw error;
    }
  }

  if (clients.firecrawl) {
    try {
      const results = await clients.firecrawl.search(query, { limit: opts.limit, timeoutMs: opts.timeoutMs });
      return results.map((r) => ({ provider: "firecrawl" as const, title: r.title, url: r.url, text: r.markdown }));
    } catch (error) {
      if (!(error instanceof FirecrawlApiError)) throw error;
    }
  }

  throw new ResearchUnavailableError(
    "Web search is unavailable — connect Exa or Firecrawl in Settings → Integrations (or check why the connected one failed).",
  );
}

/**
 * Fetch one already-known URL's content. Firecrawl is the primary provider
 * — a real scrape, handling JS-rendered pages and returning clean markdown.
 * Exa's `/contents` (extracted text from its own index/cache of the page)
 * runs only as a fallback, when the organization has no Firecrawl
 * connection or its request fails.
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

  if (clients.exa) {
    try {
      const page = await clients.exa.fetchContents(url, { timeoutMs: opts.timeoutMs });
      return { provider: "exa", title: page.title, url: page.url, text: page.text };
    } catch (error) {
      if (!(error instanceof ExaApiError)) throw error;
    }
  }

  throw new ResearchUnavailableError(
    "Web content fetch is unavailable — connect Firecrawl or Exa in Settings → Integrations (or check why the connected one failed).",
  );
}
