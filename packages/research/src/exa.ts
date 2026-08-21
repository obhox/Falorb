import { truncateText } from "./truncate";

/**
 * Exa's neural search API — finds pages relevant to a query and, with
 * `contents.text` requested inline, returns each result's extracted text
 * alongside it. `@falorb/research`'s orchestration (`search`, `fetchPage`
 * in `index.ts`) treats this as the primary search provider, falling back
 * to Firecrawl's own search only if Exa is unconfigured or errors — never
 * both at once for the same request.
 */
export class ExaApiError extends Error {}

export interface ExaSearchResult {
  title: string | null;
  url: string;
  publishedDate: string | null;
  author: string | null;
  /** Extracted page text, capped at the request's `textCharLimit`. Null if Exa had none. */
  text: string | null;
}

export interface ExaSearchOptions {
  /** Defaults to 5. */
  numResults?: number;
  /** Defaults to 20s. */
  timeoutMs?: number;
  /** Per-result extracted-text budget, applied client-side after the response arrives. Defaults to 2000. */
  textCharLimit?: number;
  /** ISO date string — restrict to pages published on or after this date. */
  startPublishedDate?: string;
}

interface ExaSearchResponseBody {
  results?: Array<{
    title?: string | null;
    url: string;
    publishedDate?: string | null;
    author?: string | null;
    text?: string | null;
  }>;
}

/**
 * Search the web via Exa. Throws `ExaApiError` (never returns a partial or
 * empty-by-failure result) so a caller can distinguish "found nothing" from
 * "the request itself failed" and decide whether to degrade gracefully.
 */
export async function searchWeb(query: string, opts: ExaSearchOptions = {}): Promise<ExaSearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new ExaApiError("Web search is not configured — EXA_API_KEY is missing.");
  }

  let response: Response;
  try {
    response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: opts.numResults ?? 5,
        contents: { text: { maxCharacters: opts.textCharLimit ?? 2000 } },
        ...(opts.startPublishedDate ? { startPublishedDate: opts.startPublishedDate } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (error) {
    throw new ExaApiError(
      `Could not reach Exa: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ExaApiError("Exa rejected the request: invalid API key.");
    }
    if (response.status === 402) {
      throw new ExaApiError("Exa rejected the request: insufficient credits.");
    }
    throw new ExaApiError(`Exa request failed (${response.status}).`);
  }

  const body = (await response.json()) as ExaSearchResponseBody;
  const limit = opts.textCharLimit ?? 2000;

  return (body.results ?? []).map((r) => ({
    title: r.title ?? null,
    url: r.url,
    publishedDate: r.publishedDate ?? null,
    author: r.author ?? null,
    text: r.text ? truncateText(r.text, limit) : null,
  }));
}

export interface ExaContentsResult {
  title: string | null;
  url: string;
  text: string;
}

interface ExaContentsResponseBody {
  results?: Array<{ title?: string | null; url: string; text?: string | null }>;
}

/**
 * Fetch Exa's extracted text for one already-known URL — `/contents`, not
 * `/search`. Exists as the fallback path for a caller that primarily wants
 * a Firecrawl scrape of a specific page (`@falorb/research`'s `fetchPage`)
 * but Firecrawl is unavailable; it is not as thorough a scrape as
 * Firecrawl's, but draws on the same Exa key rather than requiring both
 * providers configured at once.
 */
export async function fetchContents(
  url: string,
  opts: { timeoutMs?: number; textCharLimit?: number } = {},
): Promise<ExaContentsResult> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) {
    throw new ExaApiError("Web content fetch is not configured — EXA_API_KEY is missing.");
  }

  let response: Response;
  try {
    response = await fetch("https://api.exa.ai/contents", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        urls: [url],
        text: { maxCharacters: opts.textCharLimit ?? 3000 },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (error) {
    throw new ExaApiError(
      `Could not reach Exa: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ExaApiError("Exa rejected the request: invalid API key.");
    }
    if (response.status === 402) {
      throw new ExaApiError("Exa rejected the request: insufficient credits.");
    }
    throw new ExaApiError(`Exa request failed (${response.status}).`);
  }

  const body = (await response.json()) as ExaContentsResponseBody;
  const result = body.results?.[0];
  if (!result?.text) {
    throw new ExaApiError("Exa returned no content for this page.");
  }

  return { title: result.title ?? null, url: result.url, text: result.text };
}
