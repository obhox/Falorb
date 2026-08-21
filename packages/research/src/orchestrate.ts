import { ExaApiError, fetchContents, searchWeb as exaSearchWeb } from "./exa";
import { FirecrawlApiError, scrapeUrl, searchWeb as firecrawlSearchWeb } from "./firecrawl";

/**
 * Exa and Firecrawl are fallbacks for each other, never called together for
 * the same request — each of `search` and `fetchPage` below tries exactly
 * one provider, and only reaches for the other if the first is unconfigured
 * or its request itself fails (an `ExaApiError`/`FirecrawlApiError`, not a
 * caller bug). Thrown when *both* are unavailable, so a feature can degrade
 * gracefully in one place instead of every caller re-deriving "neither
 * worked."
 */
export class ResearchUnavailableError extends Error {}

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
 * (each result scraped to markdown) runs only as a fallback, when Exa is
 * unconfigured or its request fails.
 */
export async function search(query: string, opts: SearchOptions = {}): Promise<ResearchResult[]> {
  try {
    const results = await exaSearchWeb(query, { numResults: opts.limit, timeoutMs: opts.timeoutMs });
    return results
      .filter((r) => r.text)
      .map((r) => ({ provider: "exa" as const, title: r.title, url: r.url, text: r.text! }));
  } catch (error) {
    if (!(error instanceof ExaApiError)) throw error;
  }

  try {
    const results = await firecrawlSearchWeb(query, { limit: opts.limit, timeoutMs: opts.timeoutMs });
    return results.map((r) => ({ provider: "firecrawl" as const, title: r.title, url: r.url, text: r.markdown }));
  } catch (error) {
    if (!(error instanceof FirecrawlApiError)) throw error;
    throw new ResearchUnavailableError(
      "Web search is unavailable — configure EXA_API_KEY or FIRECRAWL_API_KEY (or check why both requests failed).",
    );
  }
}

/**
 * Fetch one already-known URL's content. Firecrawl is the primary provider
 * — a real scrape, handling JS-rendered pages and returning clean markdown.
 * Exa's `/contents` (extracted text from its own index/cache of the page)
 * runs only as a fallback, when Firecrawl is unconfigured or its request
 * fails.
 */
export async function fetchPage(url: string, opts: { timeoutMs?: number } = {}): Promise<ResearchResult> {
  try {
    const page = await scrapeUrl(url, { timeoutMs: opts.timeoutMs });
    return { provider: "firecrawl", title: page.title, url: page.url, text: page.markdown };
  } catch (error) {
    if (!(error instanceof FirecrawlApiError)) throw error;
  }

  try {
    const page = await fetchContents(url, { timeoutMs: opts.timeoutMs });
    return { provider: "exa", title: page.title, url: page.url, text: page.text };
  } catch (error) {
    if (!(error instanceof ExaApiError)) throw error;
    throw new ResearchUnavailableError(
      "Web content fetch is unavailable — configure FIRECRAWL_API_KEY or EXA_API_KEY (or check why both requests failed).",
    );
  }
}
