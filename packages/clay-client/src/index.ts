/**
 * Typed client for Clay's public API, used to enrich contact info for
 * prospects discovered off-site (`apps/worker/src/jobs/clay-enrichment.ts`,
 * FEATURES.md §17). Same shape as `@falorb/linki-client`/`@falorb/bund-ai-client`
 * so it plugs into the generic `integrationConnections` connect/test/revoke
 * actions (`apps/web/src/server/actions/integrations.ts`) unchanged.
 *
 * Unlike Linki/Bund AI, Clay has one fixed API root rather than a
 * per-organization self-hosted deployment — `baseUrl` is still a constructor
 * argument for symmetry with the other clients and for testability, but the
 * connect action supplies Clay's real API root itself rather than asking the
 * user to enter one.
 *
 * The exact endpoint paths and request/response shapes below are written
 * against Clay's documented enrichment-API contract, not confirmed against a
 * live account — verify against Clay's current API docs before pointing this
 * at production traffic, same caveat the original enrichment job carried.
 */

export interface ClayClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class ClayApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Clay API error (HTTP ${status}): ${JSON.stringify(body)}`);
  }
}

export interface ClayPersonEnrichmentInput {
  name?: string | null;
  socialHandle?: string | null;
  sourceUrl?: string | null;
}

export interface ClayPersonEnrichment {
  name: string | null;
  email: string | null;
  title: string | null;
  linkedinUrl: string | null;
  companyDomain: string | null;
}

interface RawEnrichmentResponse {
  name?: string;
  email?: string;
  title?: string;
  linkedin_url?: string;
  company_domain?: string;
}

/** Pulled out of `ClayClient.enrichPerson` so the response shape is
 * unit-testable without a network call. A match with neither an email nor a
 * LinkedIn URL is treated as no match — a cacheable miss, not a partial hit. */
export function parseEnrichmentResponse(body: RawEnrichmentResponse): ClayPersonEnrichment | null {
  if (!body.email && !body.linkedin_url) return null;
  return {
    name: body.name ?? null,
    email: body.email ?? null,
    title: body.title ?? null,
    linkedinUrl: body.linkedin_url ?? null,
    companyDomain: body.company_domain ?? null,
  };
}

const DEFAULT_TIMEOUT_MS = 8000;

/** Clay's fixed API root — used when no per-connection override is stored. */
export const CLAY_DEFAULT_BASE_URL = "https://api.clay.com";

export class ClayClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: ClayClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const responseBody = await response.json().catch(() => null);
      if (!response.ok) throw new ClayApiError(response.status, responseBody);
      return responseBody as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Enrich one person by whatever identifying signal is available. Returns
   * null on a real, cacheable miss (404, or a match with neither an email nor
   * a LinkedIn URL) rather than throwing — a miss is not a failure.
   */
  async enrichPerson(input: ClayPersonEnrichmentInput): Promise<ClayPersonEnrichment | null> {
    let body: RawEnrichmentResponse;
    try {
      body = await this.request<RawEnrichmentResponse>("POST", "/v3/enrich/person", {
        name: input.name ?? undefined,
        social_handle: input.socialHandle ?? undefined,
        source_url: input.sourceUrl ?? undefined,
      });
    } catch (error) {
      if (error instanceof ClayApiError && error.status === 404) return null;
      throw error;
    }

    return parseEnrichmentResponse(body);
  }

  /**
   * No dedicated health endpoint confirmed — the cheapest authenticated call
   * that proves the key works without side effects or spending an enrichment
   * credit is a "who am I" read, same reasoning as `LinkiClient`'s comment.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.request<unknown>("GET", "/v3/me");
      return { ok: true, detail: "Clay reachable and key accepted." };
    } catch (error) {
      if (error instanceof ClayApiError) {
        return { ok: false, detail: `Clay returned HTTP ${error.status}: ${JSON.stringify(error.body)}` };
      }
      return { ok: false, detail: String(error) };
    }
  }
}
