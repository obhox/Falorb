/**
 * Typed client for Firecrawl's scrape and search APIs — fetches one known
 * URL as clean, boilerplate-stripped markdown (handling JS-rendered pages
 * Exa's inline extraction doesn't attempt to), and can search the web with
 * the same scraping applied to each result. Same shape as
 * `@falorb/linki-client`/`@falorb/clay-client` so it plugs into the generic
 * `integrationConnections` connect/test/revoke actions
 * (`apps/web/src/server/actions/integrations.ts`) unchanged — a
 * per-organization connection, not a platform-wide key.
 *
 * Firecrawl has one fixed API root rather than a per-organization
 * deployment — `baseUrl` is still a constructor argument for symmetry with
 * Linki/Bund AI and for testability, but the connect action supplies
 * Firecrawl's real API root itself rather than asking the user to enter one
 * (see `FIRECRAWL_DEFAULT_BASE_URL`).
 *
 * `@falorb/research`'s orchestration (`fetchPage`, `search` in
 * `orchestrate.ts`) treats scraping as this provider's primary role — a
 * known URL is scraped here first, falling back to an `ExaClient`'s
 * `/contents` only if no Firecrawl connection exists or the request errors
 * — and treats its search as the fallback for Exa's search, never both at
 * once for the same request.
 */
export class FirecrawlApiError extends Error {}

/** Firecrawl's fixed API root — used when no per-connection override is stored. */
export const FIRECRAWL_DEFAULT_BASE_URL = "https://api.firecrawl.dev";

export interface FirecrawlClientOptions {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
}

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

interface FirecrawlCreditUsageResponseBody {
  success?: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 25_000;

export class FirecrawlClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: FirecrawlClientOptions) {
    this.baseUrl = (opts.baseUrl ?? FIRECRAWL_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
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

    return (await response.json()) as T;
  }

  /**
   * Scrape one URL via Firecrawl. Throws `FirecrawlApiError` on any failure
   * — including a 200 response with `success: false`, or a page that
   * yields no markdown (e.g. blocked by robots.txt) — so a caller never
   * mistakes an empty scrape for an empty page.
   */
  async scrapeUrl(url: string, opts: FirecrawlScrapeOptions = {}): Promise<FirecrawlScrapeResult> {
    const body = await this.request<FirecrawlScrapeResponseBody>(
      "POST",
      "/v1/scrape",
      { url, formats: ["markdown"], onlyMainContent: true },
      opts.timeoutMs,
    );

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

  /**
   * Search the web via Firecrawl, with each result scraped to markdown
   * inline (`scrapeOptions`) — the fallback path for a caller that
   * primarily wants Exa's search but no Exa connection exists. Results
   * with no scrapable markdown are dropped rather than returned empty.
   */
  async search(query: string, opts: FirecrawlSearchOptions = {}): Promise<FirecrawlSearchResult[]> {
    const body = await this.request<FirecrawlSearchResponseBody>(
      "POST",
      "/v1/search",
      { query, limit: opts.limit ?? 5, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } },
      opts.timeoutMs,
    );

    if (body.success === false) {
      throw new FirecrawlApiError(body.error ?? "Firecrawl could not search the web.");
    }

    return (body.data ?? [])
      .filter((r): r is { url: string; title?: string | null; markdown: string } => Boolean(r.markdown))
      .map((r) => ({ title: r.title ?? null, url: r.url, markdown: r.markdown }));
  }

  /**
   * `GET /v1/team/credit-usage` — a real, free (no credits spent) endpoint
   * that 401s on an invalid key, unlike scrape/search which would spend a
   * credit just to prove the key works.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.request<FirecrawlCreditUsageResponseBody>(
        "GET",
        "/v1/team/credit-usage",
        undefined,
        10_000,
      );
      return { ok: true, detail: "Firecrawl reachable and key accepted." };
    } catch (error) {
      if (error instanceof FirecrawlApiError) return { ok: false, detail: error.message };
      return { ok: false, detail: String(error) };
    }
  }
}
