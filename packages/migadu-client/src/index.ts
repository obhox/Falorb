/**
 * Typed client for Migadu — a low-cost email hosting provider used here as
 * cold-outreach sending infrastructure (mailbox provisioning, sending,
 * receiving), confirmed against Migadu's published REST API
 * (https://migadu.com/api/).
 *
 * Migadu's REST API only manages account resources (domains, mailboxes,
 * identities, aliases) — it has no endpoint to send or read a message. Actual
 * mail moves over SMTP (`sendMail`, `smtp.ts`) and IMAP (`fetchNewMessages`,
 * `imap.ts`), both re-exported from here so a caller only ever imports one
 * package for everything Migadu-shaped, the same way `BufferClient` hides
 * Buffer's GraphQL specifics from `buffer-sync.ts`.
 *
 * One wrinkle every other client in this monorepo doesn't have: Migadu's REST
 * API is HTTP Basic Auth over an *admin email* (the username) plus an *API
 * key* (the password) — two secrets, not one. `MigaduClient` still takes the
 * same `{ baseUrl, apiKey }` shape as every other client so construction sites
 * (`pingProvider`, `getMigaduClient`) need no special casing — `apiKey` here
 * is a JSON-encoded `{ username, apiKey }` pair, parsed back out below. See
 * `packages/db/src/schema/integrations.ts` for how that pair is stored.
 */

export const MIGADU_API_ENDPOINT = "https://api.migadu.com/v1";

export class MigaduApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Migadu API error (HTTP ${status}): ${JSON.stringify(body)}`);
  }
}

export interface MigaduClientOptions {
  baseUrl: string;
  /** JSON-encoded `{ username, apiKey }` — see module doc. */
  apiKey: string;
  timeoutMs?: number;
}

export interface MigaduDomain {
  domain_name: string;
  [key: string]: unknown;
}

export interface MigaduMailbox {
  local_part: string;
  domain_name: string;
  address: string;
  name: string | null;
  [key: string]: unknown;
}

export interface CreateMailboxInput {
  localPart: string;
  name: string;
  /** Set directly rather than asking Migadu to generate one, so Falorb holds the only copy from the start. */
  password: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function parseCredential(raw: string): { username: string; apiKey: string } {
  try {
    const parsed = JSON.parse(raw) as { username?: unknown; apiKey?: unknown };
    if (typeof parsed.username === "string" && typeof parsed.apiKey === "string") {
      return { username: parsed.username, apiKey: parsed.apiKey };
    }
  } catch {
    // fall through to the error below
  }
  throw new Error("Malformed Migadu credential — expected a JSON-encoded { username, apiKey } pair.");
}

export class MigaduClient {
  private baseUrl: string;
  private username: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: MigaduClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    const credential = parseCredential(opts.apiKey);
    this.username = credential.username;
    this.apiKey = credential.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(method: string, path: string, opts?: { body?: unknown }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.apiKey}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new MigaduApiError(response.status, body);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** `GET /domains` returns `{ domains: [...] }` per Migadu's docs. */
  async listDomains(): Promise<MigaduDomain[]> {
    const result = await this.request<{ domains: MigaduDomain[] }>("GET", "domains");
    return result.domains;
  }

  async listMailboxes(domain: string): Promise<MigaduMailbox[]> {
    const result = await this.request<{ mailboxes: MigaduMailbox[] }>("GET", `domains/${domain}/mailboxes`);
    return result.mailboxes;
  }

  createMailbox(domain: string, input: CreateMailboxInput): Promise<MigaduMailbox> {
    return this.request<MigaduMailbox>("POST", `domains/${domain}/mailboxes`, {
      body: {
        local_part: input.localPart,
        name: input.name,
        password: input.password,
        password_use_auto: false,
        password_recovery_email: null,
        is_internal: false,
      },
    });
  }

  deleteMailbox(domain: string, localPart: string): Promise<void> {
    return this.request<void>("DELETE", `domains/${domain}/mailboxes/${localPart}`);
  }

  /**
   * No dedicated health endpoint — the cheapest authenticated call that
   * proves both halves of the credential without a side effect is listing
   * the account's domains, same reasoning as `LinkiClient.verifyConnection`.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const domains = await this.listDomains();
      return { ok: true, detail: `Migadu reachable — ${domains.length} domain(s) on this account.` };
    } catch (error) {
      if (error instanceof MigaduApiError) {
        return { ok: false, detail: `Migadu returned HTTP ${error.status}: ${JSON.stringify(error.body)}` };
      }
      return { ok: false, detail: String(error) };
    }
  }
}

export * from "./smtp";
export * from "./imap";
