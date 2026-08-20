/**
 * Typed client for Bund AI's `/api/v1/*` public REST API — confirmed against
 * the actual route handlers added in the Bund AI repo
 * (`/Users/obhox/Projects/bund-ai-public/app/api/v1/*`), not guessed.
 *
 * Read-only for now: `escalations:write` exists as a scope on the Bund AI
 * side but no write route is implemented yet — that's Phase B6, gated.
 */

export interface BundAiClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class BundAiApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Bund AI API error (HTTP ${status}): ${JSON.stringify(body)}`);
  }
}

export interface BundAiConversation {
  id: string;
  channel: string;
  externalUserRef: string | null;
  status: string;
  startedAt: string;
  lastActivityAt: string;
}

export interface BundAiEscalation {
  id: string;
  conversationId: string;
  reason: string;
  summary: string;
  status: string;
  assignedTo: string | null;
  customerContact: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface BundAiLead {
  id: string;
  conversationId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  intent: string;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface BundAiTicket {
  id: string;
  conversationId: string | null;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  customerName: string | null;
  customerContact: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface PageParams {
  limit?: number;
  offset?: number;
  since?: string;
  [key: string]: string | number | undefined;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class BundAiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: BundAiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    path: string,
    params?: PageParams,
    opts?: { method?: string; body?: unknown },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1/${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: opts?.method ?? "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(opts?.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new BundAiApiError(response.status, body);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  listConversations(
    params?: PageParams,
  ): Promise<{ conversations: BundAiConversation[]; limit: number; offset: number }> {
    return this.request("conversations", params);
  }

  listEscalations(
    params?: PageParams,
  ): Promise<{ escalations: BundAiEscalation[]; limit: number; offset: number }> {
    return this.request("escalations", params);
  }

  listLeads(params?: PageParams): Promise<{ leads: BundAiLead[]; limit: number; offset: number }> {
    return this.request("leads", params);
  }

  listTickets(
    params?: PageParams,
  ): Promise<{ tickets: BundAiTicket[]; limit: number; offset: number }> {
    return this.request("tickets", params);
  }

  /** Scope `escalations:write`. The only supported transition — see the route's own doc comment on the Bund AI side. */
  resolveEscalation(id: string): Promise<{ id: string; status: string; resolvedAt: string }> {
    return this.request(`escalations/${id}`, undefined, { method: "PATCH", body: { status: "resolved" } });
  }

  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const result = await this.request<{ ok: boolean; business: { id: string; name: string } | null }>(
        "health",
      );
      return {
        ok: result.ok,
        detail: result.business ? `Connected to "${result.business.name}".` : "Connected.",
      };
    } catch (error) {
      if (error instanceof BundAiApiError) {
        return { ok: false, detail: `Bund AI returned HTTP ${error.status}: ${JSON.stringify(error.body)}` };
      }
      return { ok: false, detail: String(error) };
    }
  }
}
