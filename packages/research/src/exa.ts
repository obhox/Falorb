import { truncateText } from "./truncate";

/**
 * Typed client for Exa's neural search API — finds pages relevant to a
 * query and, with `contents.text` requested inline, returns each result's
 * extracted text alongside it. Same shape as `@falorb/linki-client`/
 * `@falorb/clay-client` so it plugs into the generic `integrationConnections`
 * connect/test/revoke actions (`apps/web/src/server/actions/integrations.ts`)
 * unchanged — a per-organization connection, not a platform-wide key.
 *
 * Exa has one fixed API root rather than a per-organization deployment —
 * `baseUrl` is still a constructor argument for symmetry with Linki/Bund AI
 * and for testability, but the connect action supplies Exa's real API root
 * itself rather than asking the user to enter one (see `EXA_DEFAULT_BASE_URL`).
 *
 * `@falorb/research`'s orchestration (`search`, `fetchPage` in
 * `orchestrate.ts`) treats this as the primary search provider, falling
 * back to a `FirecrawlClient`'s own search only if no `ExaClient` is
 * connected or the request errors — never both at once for the same request.
 */
export class ExaApiError extends Error {}

/** Exa's fixed API root — used when no per-connection override is stored. */
export const EXA_DEFAULT_BASE_URL = "https://api.exa.ai";

export interface ExaClientOptions {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
}

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

export interface ExaContentsResult {
  title: string | null;
  url: string;
  text: string;
}

interface ExaContentsResponseBody {
  results?: Array<{ title?: string | null; url: string; text?: string | null }>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class ExaClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: ExaClientOptions) {
    this.baseUrl = (opts.baseUrl ?? EXA_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
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

    return (await response.json()) as T;
  }

  /**
   * Search the web via Exa. Throws `ExaApiError` (never returns a partial or
   * empty-by-failure result) so a caller can distinguish "found nothing"
   * from "the request itself failed" and decide whether to degrade
   * gracefully.
   */
  async search(query: string, opts: ExaSearchOptions = {}): Promise<ExaSearchResult[]> {
    const limit = opts.textCharLimit ?? 2000;
    const body = await this.request<ExaSearchResponseBody>(
      "/search",
      {
        query,
        numResults: opts.numResults ?? 5,
        contents: { text: { maxCharacters: limit } },
        ...(opts.startPublishedDate ? { startPublishedDate: opts.startPublishedDate } : {}),
      },
      opts.timeoutMs,
    );

    return (body.results ?? []).map((r) => ({
      title: r.title ?? null,
      url: r.url,
      publishedDate: r.publishedDate ?? null,
      author: r.author ?? null,
      text: r.text ? truncateText(r.text, limit) : null,
    }));
  }

  /**
   * Fetch Exa's extracted text for one already-known URL — `/contents`, not
   * `/search`. Exists as the fallback path for a caller that primarily
   * wants a Firecrawl scrape of a specific page (`@falorb/research`'s
   * `fetchPage`) but no Firecrawl connection exists; it is not as thorough
   * a scrape as Firecrawl's, but draws on the same Exa connection rather
   * than requiring both providers connected at once.
   */
  async fetchContents(
    url: string,
    opts: { timeoutMs?: number; textCharLimit?: number } = {},
  ): Promise<ExaContentsResult> {
    const body = await this.request<ExaContentsResponseBody>(
      "/contents",
      { urls: [url], text: { maxCharacters: opts.textCharLimit ?? 3000 } },
      opts.timeoutMs,
    );

    const result = body.results?.[0];
    if (!result?.text) {
      throw new ExaApiError("Exa returned no content for this page.");
    }

    return { title: result.title ?? null, url: result.url, text: result.text };
  }

  /**
   * No dedicated "who am I" endpoint — a minimal, single-result search with
   * no content extraction is the cheapest real call that proves the key
   * works, same reasoning as `LinkiClient`'s connection test.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.request<ExaSearchResponseBody>(
        "/search",
        { query: "connection test", numResults: 1 },
        10_000,
      );
      return { ok: true, detail: "Exa reachable and key accepted." };
    } catch (error) {
      if (error instanceof ExaApiError) return { ok: false, detail: error.message };
      return { ok: false, detail: String(error) };
    }
  }
}
