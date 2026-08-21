/**
 * Firecrawl's scrape and search APIs — fetches one known URL as clean,
 * boilerplate-stripped markdown (handling JS-rendered pages Exa's inline
 * extraction doesn't attempt to), and can search the web with the same
 * scraping applied to each result. `@falorb/research`'s orchestration
 * (`fetchPage`, `search` in `index.ts`) treats scraping as this provider's
 * primary role — a known URL is scraped here first, falling back to Exa's
 * `/contents` only if Firecrawl is unconfigured or errors — and treats its
 * search as the fallback for Exa's search, never both at once for the same
 * request.
 */
export class FirecrawlApiError extends Error {}

export interface FirecrawlScrapeResult {
  url: string;
  title: string | null;
  description: string | null;
  markdown: string;
}

export interface FirecrawlScrapeOptions {
  /** Defaults to 25s — Firecrawl renders JS pages, which is slower than a plain fetch. */
  timeoutMs?: number;
}

interface FirecrawlScrapeResponseBody {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
    };
  };
}

/**
 * Scrape one URL via Firecrawl. Throws `FirecrawlApiError` on any failure —
 * including a 200 response with `success: false`, or a page that yields no
 * markdown (e.g. blocked by robots.txt) — so a caller never mistakes an
 * empty scrape for an empty page.
 */
export async function scrapeUrl(
  url: string,
  opts: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new FirecrawlApiError("Page scraping is not configured — FIRECRAWL_API_KEY is missing.");
  }

  let response: Response;
  try {
    response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });
  } catch (error) {
    throw new FirecrawlApiError(
      `Could not reach Firecrawl: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new FirecrawlApiError("Firecrawl rejected the request: invalid API key.");
    }
    if (response.status === 402) {
      throw new FirecrawlApiError("Firecrawl rejected the request: insufficient credits.");
    }
    throw new FirecrawlApiError(`Firecrawl request failed (${response.status}).`);
  }

  const body = (await response.json()) as FirecrawlScrapeResponseBody;
  if (body.success === false) {
    throw new FirecrawlApiError(body.error ?? "Firecrawl could not scrape this page.");
  }

  const markdown = body.data?.markdown?.trim();
  if (!markdown) {
    throw new FirecrawlApiError("Firecrawl returned no content for this page.");
  }

  return {
    url,
    title: body.data?.metadata?.title ?? null,
    description: body.data?.metadata?.description ?? null,
    markdown,
  };
}

export interface FirecrawlSearchResult {
  title: string | null;
  url: string;
  /** Scraped markdown for this result — always present; a result Firecrawl couldn't scrape is dropped. */
  markdown: string;
}

export interface FirecrawlSearchOptions {
  /** Defaults to 5. */
  limit?: number;
  /** Defaults to 25s — each result is scraped, not just indexed. */
  timeoutMs?: number;
}

interface FirecrawlSearchResponseBody {
  success?: boolean;
  error?: string;
  data?: Array<{ url: string; title?: string | null; markdown?: string | null }>;
}

/**
 * Search the web via Firecrawl, with each result scraped to markdown
 * inline (`scrapeOptions`) — the fallback path for a caller that primarily
 * wants Exa's search but Exa is unavailable. Results with no scrapable
 * markdown are dropped rather than returned empty.
 */
export async function searchWeb(
  query: string,
  opts: FirecrawlSearchOptions = {},
): Promise<FirecrawlSearchResult[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new FirecrawlApiError("Web search is not configured — FIRECRAWL_API_KEY is missing.");
  }

  let response: Response;
  try {
    response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit: opts.limit ?? 5,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });
  } catch (error) {
    throw new FirecrawlApiError(
      `Could not reach Firecrawl: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new FirecrawlApiError("Firecrawl rejected the request: invalid API key.");
    }
    if (response.status === 402) {
      throw new FirecrawlApiError("Firecrawl rejected the request: insufficient credits.");
    }
    throw new FirecrawlApiError(`Firecrawl request failed (${response.status}).`);
  }

  const body = (await response.json()) as FirecrawlSearchResponseBody;
  if (body.success === false) {
    throw new FirecrawlApiError(body.error ?? "Firecrawl could not search the web.");
  }

  return (body.data ?? [])
    .filter((r): r is { url: string; title?: string | null; markdown: string } => Boolean(r.markdown))
    .map((r) => ({ title: r.title ?? null, url: r.url, markdown: r.markdown }));
}
