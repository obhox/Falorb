/**
 * Firecrawl's single-page scrape API — fetches one known URL and returns
 * clean, boilerplate-stripped markdown, handling JS-rendered pages and
 * paywall-adjacent cruft Exa's inline extraction doesn't attempt to. Used
 * where a caller already knows which page it wants (a company's own
 * website, a search result Exa surfaced) and needs the full content, not
 * just a search snippet.
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
