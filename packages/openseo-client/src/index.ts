/**
 * Typed client for OpenSEO (openseo.so) — keyword research, live SERP,
 * competitor/domain data, backlinks, rank tracking, and Google Search
 * Console reporting.
 *
 * Unlike Linki/Bund AI, OpenSEO exposes no REST API at all — the hosted MCP
 * endpoint (`https://app.openseo.so/mcp`) is the only surface. That's a
 * protocol built for interactive tool-calling (JSON-RPC over Streamable
 * HTTP), not a typical backend-to-backend contract, but nothing stops a
 * plain server from being an MCP *client* itself: this wraps
 * `@modelcontextprotocol/sdk`'s `Client` the same way `apps/mcp/src/smoke.ts`
 * does when it drives Falorb's own MCP server, just against a hosted
 * endpoint over Streamable HTTP instead of a local stdio process — the same
 * transport `apps/mcp`'s own server already speaks.
 *
 * OpenSEO's docs describe tool *categories* (research keywords, get SERP
 * results, get domain overview, ...) rather than publishing exact literal
 * tool names or parameter schemas. Rather than hardcode a guess that could
 * silently be wrong, each capability below is resolved at runtime against
 * the server's own `tools/list` result, matched against a short list of
 * likely names and cached per connection — see `resolveToolName`. If
 * OpenSEO's real tool names don't match any candidate, the call fails
 * loudly with the capability name and the full list of tools the server
 * actually advertised, rather than a confusing "tool not found" from the
 * SDK.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** OpenSEO's one hosted MCP endpoint — same convention as `CLAY_DEFAULT_BASE_URL`/`ELEVENLABS_DEFAULT_BASE_URL`. */
export const OPENSEO_DEFAULT_BASE_URL = "https://app.openseo.so/mcp";

export interface OpenSeoClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Per-call MCP request timeout, in ms. Passed straight through to the SDK's own `RequestOptions.timeout`. */
  timeoutMs?: number;
}

export class OpenSeoApiError extends Error {
  constructor(
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "OpenSeoApiError";
  }
}

/** Volume/difficulty/CPC estimate for one keyword idea. */
export interface OpenSeoKeywordIdea {
  keyword: string;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  intent?: string;
  [key: string]: unknown;
}

/** One row of a live Google organic SERP. */
export interface OpenSeoSerpResult {
  position?: number;
  url?: string;
  title?: string;
  domain?: string;
  [key: string]: unknown;
}

/** A domain's organic-search footprint, as OpenSEO summarizes it. */
export interface OpenSeoDomainOverview {
  domain: string;
  organicTraffic?: number;
  organicKeywords?: number;
  [key: string]: unknown;
}

/** One keyword a domain currently ranks for. */
export interface OpenSeoDomainKeyword {
  keyword: string;
  position?: number;
  url?: string;
  volume?: number;
  [key: string]: unknown;
}

/** Backlink/referring-domain statistics for a domain. */
export interface OpenSeoBacklinksOverview {
  domain: string;
  totalBacklinks?: number;
  referringDomains?: number;
  [key: string]: unknown;
}

/** A tracked keyword's latest rank-tracker position for a domain/project. */
export interface OpenSeoRankTrackerEntry {
  keyword: string;
  position?: number;
  previousPosition?: number;
  url?: string;
  [key: string]: unknown;
}

/** One row of Google Search Console performance data. */
export interface OpenSeoGscPerformanceRow {
  query?: string;
  page?: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  [key: string]: unknown;
}

/** Index coverage / crawl / canonical / rich-result signals for one URL. */
export interface OpenSeoUrlInspection {
  url: string;
  coverageState?: string;
  [key: string]: unknown;
}

/**
 * Capabilities this client exposes, each resolved to whichever real MCP
 * tool name the connected server advertises — see the module doc comment.
 * Ordered candidate lists, most-likely-literal-name first.
 */
const TOOL_CANDIDATES = {
  researchKeywords: ["research_keywords", "keyword_research", "get_keyword_ideas"],
  getSerpResults: ["get_serp_results", "get_serp", "serp_results"],
  saveKeyword: ["save_keywords", "save_keyword", "save_keyword_opportunity"],
  getRankTracker: ["get_rank_tracker_data", "get_rank_tracker", "rank_tracker"],
  getDomainOverview: ["get_domain_overview", "domain_overview"],
  getDomainKeywords: ["get_domain_keywords", "domain_keywords"],
  getBacklinksOverview: ["get_backlinks_overview", "get_backlinks", "backlinks_overview"],
  getGscPerformance: ["get_gsc_performance", "gsc_performance", "get_search_console_performance"],
  inspectUrl: ["inspect_url", "inspect_urls", "url_inspection"],
} as const satisfies Record<string, readonly string[]>;

type Capability = keyof typeof TOOL_CANDIDATES;

const DEFAULT_TIMEOUT_MS = 15_000;

export class OpenSeoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private toolNames: Map<Capability, string> | null = null;
  private availableToolNames: string[] = [];

  constructor(opts: OpenSeoClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const client = new Client({ name: "falorb", version: "0.1.0" });
        const transport = new StreamableHTTPClientTransport(new URL(this.baseUrl), {
          requestInit: { headers: { Authorization: `Bearer ${this.apiKey}` } },
        });
        try {
          await client.connect(transport);
        } catch (error) {
          throw new OpenSeoApiError("Could not connect to the OpenSEO MCP server.", error);
        }
        this.client = client;
        return client;
      })().catch((error) => {
        this.connecting = null;
        throw error;
      });
    }
    return this.connecting;
  }

  private async resolveToolName(capability: Capability): Promise<string> {
    if (this.toolNames?.has(capability)) return this.toolNames.get(capability)!;

    const client = await this.ensureConnected();
    if (!this.toolNames) {
      const { tools } = await client.listTools(undefined, { timeout: this.timeoutMs });
      this.availableToolNames = tools.map((t) => t.name);
      const map = new Map<Capability, string>();
      for (const [cap, candidates] of Object.entries(TOOL_CANDIDATES) as [Capability, readonly string[]][]) {
        const match = tools.find((t) => (candidates as readonly string[]).includes(t.name));
        if (match) map.set(cap, match.name);
      }
      this.toolNames = map;
    }

    const resolved = this.toolNames.get(capability);
    if (!resolved) {
      throw new OpenSeoApiError(
        `OpenSEO's MCP server doesn't advertise a tool matching "${capability}" ` +
          `(tried: ${TOOL_CANDIDATES[capability].join(", ")}). ` +
          `Tools it does advertise: ${this.availableToolNames.join(", ") || "(none)"}.`,
      );
    }
    return resolved;
  }

  private async callTool<T>(capability: Capability, args: Record<string, unknown>): Promise<T> {
    const client = await this.ensureConnected();
    const name = await this.resolveToolName(capability);

    let result: unknown;
    try {
      result = await client.callTool({ name, arguments: args }, undefined, { timeout: this.timeoutMs });
    } catch (error) {
      throw new OpenSeoApiError(`OpenSEO tool "${name}" failed.`, error);
    }
    // `callTool`'s return type also covers task-augmented (call-now,
    // fetch-later) results, which have no `content` array — this client
    // never requests task mode, so that shape should never occur, but the
    // type system can't discriminate the union from the call site alone,
    // hence the runtime check.
    if (!hasToolContent(result)) {
      throw new OpenSeoApiError(`OpenSEO tool "${name}" returned a task-based result, which isn't supported here.`);
    }
    if (result.isError) {
      throw new OpenSeoApiError(`OpenSEO tool "${name}" returned an error.`, result.content);
    }
    return parseToolResult<T>(result);
  }

  /** Keyword ideas with volume, difficulty, and CPC for a seed term. */
  researchKeywords(seed: string, opts: { country?: string; limit?: number } = {}): Promise<OpenSeoKeywordIdea[]> {
    return this.callTool("researchKeywords", { keyword: seed, ...opts });
  }

  /** Live Google organic results for a keyword. */
  getSerpResults(keyword: string, opts: { country?: string } = {}): Promise<OpenSeoSerpResult[]> {
    return this.callTool("getSerpResults", { keyword, ...opts });
  }

  /** Persists a keyword opportunity inside the connected OpenSEO project. */
  saveKeyword(keyword: string, opts: Record<string, unknown> = {}): Promise<{ saved: boolean }> {
    return this.callTool("saveKeyword", { keyword, ...opts });
  }

  /** Tracked keyword positions and latest movement for a domain. */
  getRankTracker(domain: string): Promise<OpenSeoRankTrackerEntry[]> {
    return this.callTool("getRankTracker", { domain });
  }

  /** Summary of a domain's organic-search footprint — traffic and keyword counts. */
  getDomainOverview(domain: string): Promise<OpenSeoDomainOverview> {
    return this.callTool("getDomainOverview", { domain });
  }

  /** Keywords a domain (yours or a competitor's) already ranks for. */
  getDomainKeywords(domain: string, opts: { limit?: number } = {}): Promise<OpenSeoDomainKeyword[]> {
    return this.callTool("getDomainKeywords", { domain, ...opts });
  }

  /** Backlink and referring-domain counts for a domain. */
  getBacklinksOverview(domain: string): Promise<OpenSeoBacklinksOverview> {
    return this.callTool("getBacklinksOverview", { domain });
  }

  /** Clicks, impressions, CTR, and position from the connected Search Console property. */
  getGscPerformance(domain: string, opts: { days?: number } = {}): Promise<OpenSeoGscPerformanceRow[]> {
    return this.callTool("getGscPerformance", { domain, ...opts });
  }

  /** Index coverage, crawl status, canonical, mobile, and rich-result signals for one URL. */
  inspectUrl(url: string): Promise<OpenSeoUrlInspection> {
    return this.callTool("inspectUrl", { url });
  }

  /**
   * No dedicated health endpoint exists — listing tools is the cheapest
   * authenticated call that proves the key/session works without side
   * effects, and doubles as the tool-name resolution pass every other
   * method needs anyway.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const client = await this.ensureConnected();
      const { tools } = await client.listTools(undefined, { timeout: this.timeoutMs });
      this.availableToolNames = tools.map((t) => t.name);
      return { ok: true, detail: `OpenSEO reachable — ${tools.length} tool(s) available.` };
    } catch (error) {
      if (error instanceof OpenSeoApiError) {
        return { ok: false, detail: error.message };
      }
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connecting = null;
      this.toolNames = null;
    }
  }
}

function hasToolContent(
  result: unknown,
): result is { content: Array<{ type: string; text?: string }>; isError?: boolean } {
  return typeof result === "object" && result !== null && Array.isArray((result as { content?: unknown }).content);
}

function parseToolResult<T>(result: { content: Array<{ type: string; text?: string }> }): T {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (text === undefined) {
    throw new OpenSeoApiError("OpenSEO's response had no readable content.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some tools return a plain-text summary rather than JSON — hand it
    // back as-is rather than failing a call that actually succeeded.
    return text as unknown as T;
  }
}
