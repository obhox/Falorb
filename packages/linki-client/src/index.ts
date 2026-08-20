/**
 * Typed client for Linki's public REST API (`/api/v1/[resource]`), confirmed
 * against its actual route handler rather than guessed — see
 * `pages/api/v1/[...path].ts` and `lib/api-keys.ts` in the Linki repo
 * (`/Users/obhox/Projects/Sales Automation`).
 *
 * Deliberately targets `/api/v1/*`, not Linki's MCP layer — MCP is for
 * interactive chat sessions; this is the same underlying HTTP contract Linki's
 * own MCP tools call, used directly for backend-to-backend sync.
 *
 * Row types carry the fields confirmed from Linki's schema plus an index
 * signature for the rest — SQLite migrations there add columns over time
 * (`workspace_id`, `email`, `phone`, `notes`, `owner_id` on `targets`, for
 * example, added after the base `CREATE TABLE`), and claiming exhaustive
 * typing here would be less honest than a documented partial shape.
 */

export interface LinkiClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface LinkiPage<T> {
  data: T[];
  pagination: { limit: number; offset: number };
}

export class LinkiApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Linki API error (HTTP ${status}): ${JSON.stringify(body)}`);
  }
}

export interface LinkiContact {
  id: string;
  workspace_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  notes: string | null;
  owner_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiCompany {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  linkedin_url: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiList {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  purpose: "linkedin" | "email" | null;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiWorkflow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiRun {
  id: string;
  workspace_id: string;
  workflow_id: string | null;
  list_id: string | null;
  account_id: string | null;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  [key: string]: unknown;
}

export interface LinkiDomainEvent {
  id: string;
  workspace_id: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload_json: string;
  occurred_at: string;
  [key: string]: unknown;
}

export type LinkiSignalType = "job_change" | "funding" | "hiring" | "technology" | "product_intent" | "custom";

export interface LinkiSignal {
  id: string;
  workspace_id: string;
  target_id: string | null;
  company_id: string | null;
  type: LinkiSignalType;
  title: string;
  description: string | null;
  score: number;
  source: string | null;
  occurred_at: string;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiOpportunity {
  id: string;
  workspace_id: string;
  target_id: string | null;
  company_id: string | null;
  stage_id: string | null;
  owner_id: string | null;
  name: string;
  amount: number | null;
  currency: string;
  expected_close_date: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface LinkiSignalRule {
  id: string;
  workspace_id: string;
  name: string;
  signal_type: LinkiSignalType;
  min_score: number;
  list_id: string | null;
  workflow_id: string | null;
  account_id: string | null;
  enabled: 0 | 1;
  auto_start: 0 | 1;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiPipelineStage {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  probability: number;
  is_won: 0 | 1;
  is_lost: 0 | 1;
  [key: string]: unknown;
}

export interface LinkiSuppression {
  id: string;
  workspace_id: string;
  kind: "email" | "domain" | "linkedin" | "phone";
  value: string;
  reason: string;
  source: string | null;
  target_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiSentMessage {
  id: string;
  workspace_id: string;
  job_id: string;
  email_account_id: string;
  target_id: string | null;
  run_id: string | null;
  recipient: string;
  subject: string;
  message_id: string;
  status: string;
  accepted_at: string;
  delivered_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  [key: string]: unknown;
}

/** Which targets are enrolled in a run — no per-channel state; see LinkiRunProfileTrack. */
export interface LinkiRunProfile {
  id: string;
  run_id: string;
  target_id: string;
  email_account_id: string | null;
  created_at: string;
  [key: string]: unknown;
}

/** Per-target, per-channel (linkedin/email) progress within a run — the actual send/reply state. */
export interface LinkiRunProfileTrack {
  id: string;
  run_profile_id: string;
  run_id: string;
  target_id: string;
  track: "linkedin" | "email";
  state: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  current_step: number;
  last_step_at: string | null;
  next_step_at: string | null;
  error_message: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface LinkiListMember {
  list_id: string;
  target_id: string;
}

export interface LinkiIngestSignalInput {
  type: LinkiSignalType;
  title: string;
  description?: string;
  score?: number;
  source?: string;
  target_id?: string;
  company_id?: string;
  occurred_at?: string;
  metadata?: Record<string, unknown>;
}

export interface LinkiUpdateContactInput {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
  company?: string;
  location?: string;
  notes?: string;
  owner_id?: string;
}

export interface LinkiCreateContactInput {
  full_name: string;
  linkedin_url: string;
  email?: string;
  title?: string;
  company?: string;
  location?: string;
}

interface PageParams {
  limit?: number;
  offset?: number;
  [key: string]: string | number | undefined;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class LinkiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(opts: LinkiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: { query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1/${path}`);
    for (const [key, value] of Object.entries(opts?.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) throw new LinkiApiError(response.status, body);
      return body as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private list<T>(resource: string, params?: PageParams): Promise<LinkiPage<T>> {
    return this.request<LinkiPage<T>>("GET", resource, { query: params });
  }

  private one<T>(resource: string, id: string): Promise<T> {
    return this.request<T>("GET", `${resource}/${id}`);
  }

  listContacts(params?: PageParams): Promise<LinkiPage<LinkiContact>> {
    return this.list("contacts", params);
  }

  getContact(id: string): Promise<LinkiContact> {
    return this.one("contacts", id);
  }

  /** Scope `contacts:write`. */
  createContact(input: LinkiCreateContactInput): Promise<LinkiContact> {
    return this.request<LinkiContact>("POST", "contacts", { body: input });
  }

  /** Scope `contacts:write`. Only fields Linki's PATCH actually accepts — anything else is silently ignored server-side. */
  updateContact(id: string, input: LinkiUpdateContactInput): Promise<LinkiContact> {
    return this.request<LinkiContact>("PATCH", `contacts/${id}`, { body: input });
  }

  listCompanies(params?: PageParams): Promise<LinkiPage<LinkiCompany>> {
    return this.list("companies", params);
  }

  listLists(params?: PageParams): Promise<LinkiPage<LinkiList>> {
    return this.list("lists", params);
  }

  listWorkflows(params?: PageParams): Promise<LinkiPage<LinkiWorkflow>> {
    return this.list("workflows", params);
  }

  listRuns(params?: PageParams): Promise<LinkiPage<LinkiRun>> {
    return this.list("runs", params);
  }

  listEvents(params?: PageParams): Promise<LinkiPage<LinkiDomainEvent>> {
    return this.list("events", params);
  }

  listSignals(params?: PageParams): Promise<LinkiPage<LinkiSignal>> {
    return this.list("signals", params);
  }

  /** Scope `signals:write`. Linki's own `signal_rules` decide whether this triggers a live workflow (`auto_start`). */
  ingestSignal(input: LinkiIngestSignalInput): Promise<LinkiSignal> {
    return this.request<LinkiSignal>("POST", "signals", { body: input });
  }

  listOpportunities(params?: PageParams): Promise<LinkiPage<LinkiOpportunity>> {
    return this.list("opportunities", params);
  }

  getOpportunity(id: string): Promise<LinkiOpportunity> {
    return this.one("opportunities", id);
  }

  /** Read-only rule config — lets Falorb's UI show which workflow a signal will hit, and whether `auto_start` is on, before a mapping is enabled (Phase L4/L5/Gate B). */
  listSignalRules(params?: PageParams): Promise<LinkiPage<LinkiSignalRule>> {
    return this.list("signal_rules", params);
  }

  listPipelineStages(params?: PageParams): Promise<LinkiPage<LinkiPipelineStage>> {
    return this.list("pipeline_stages", params);
  }

  /** Do-not-contact list — check before pushing a signal or creating a contact for anyone (Phase L5). */
  listSuppressions(params?: PageParams): Promise<LinkiPage<LinkiSuppression>> {
    return this.list("suppressions", params);
  }

  listSentMessages(params?: PageParams): Promise<LinkiPage<LinkiSentMessage>> {
    return this.list("sent_messages", params);
  }

  /** Which targets are enrolled in a run. Requires `runId` — Linki scopes this resource by run, not by workspace alone. */
  listRunProfiles(runId: string, params?: PageParams): Promise<LinkiPage<LinkiRunProfile>> {
    return this.list("run_profiles", { ...params, run_id: runId });
  }

  /** Per-target, per-channel send/reply progress within a run. Requires `runId`. */
  listRunProfileTracks(runId: string, params?: PageParams): Promise<LinkiPage<LinkiRunProfileTrack>> {
    return this.list("run_profile_tracks", { ...params, run_id: runId });
  }

  /** List membership pairs. Full contact rows come from `listContacts` separately, so this stays lightweight. Requires `listId`. */
  listListMembers(listId: string, params?: PageParams): Promise<LinkiPage<LinkiListMember>> {
    return this.list("list_members", { ...params, list_id: listId });
  }

  /**
   * No dedicated health endpoint exists on Linki's side — the cheapest
   * authenticated call that proves the key works without side effects is a
   * one-row contacts read.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.listContacts({ limit: 1 });
      return { ok: true, detail: "Linki reachable and key accepted." };
    } catch (error) {
      if (error instanceof LinkiApiError) {
        return { ok: false, detail: `Linki returned HTTP ${error.status}: ${JSON.stringify(error.body)}` };
      }
      return { ok: false, detail: String(error) };
    }
  }
}
