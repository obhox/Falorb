/**
 * Client for an arbitrary, user-connected remote MCP (Model Context
 * Protocol) server — the generic counterpart to `@falorb/openseo-client`.
 *
 * OpenSEO is one fixed, known server: its client hardcodes a
 * capability→tool-name candidate list because the *use* of the connection is
 * known ahead of time, only the exact tool name isn't. This client has no
 * such list — an organization can connect any MCP server (Notion, an
 * internal tools server, a customer's own server), so the tools it exposes
 * are whatever `tools/list` returns, discovered live and handed back
 * verbatim rather than mapped onto a fixed set of methods. `@falorb/agents`'s
 * `mcp` toolkit is what turns that into two agent-facing tools
 * (`list_mcp_tools`, `call_mcp_tool`) rather than a method per capability.
 *
 * Same transport as `OpenSeoClient` — `@modelcontextprotocol/sdk`'s `Client`
 * over Streamable HTTP — with one addition: a fallback to
 * `SSEClientTransport` when the Streamable HTTP handshake fails, since a
 * number of MCP servers in the wild still only speak the older SSE
 * transport. A fresh `Client` is used for the retry rather than reusing the
 * failed one — the SDK's `Client` does not guarantee it is reusable after a
 * failed `connect()`.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export interface McpConnectorOptions {
  url: string;
  /** Bearer token, sent as `Authorization: Bearer <apiKey>`. Omit for a server that needs no auth. */
  apiKey?: string;
  /** Per-call MCP request timeout, in ms. Passed straight through to the SDK's own `RequestOptions.timeout`. */
  timeoutMs?: number;
}

export interface McpToolSummary {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export class McpConnectorError extends Error {
  constructor(
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "McpConnectorError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class McpConnectorClient {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(opts: McpConnectorOptions) {
    this.url = opts.url;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private get requestInit(): RequestInit | undefined {
    return this.apiKey ? { headers: { Authorization: `Bearer ${this.apiKey}` } } : undefined;
  }

  private async ensureConnected(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = this.connectWithFallback().catch((error) => {
        this.connecting = null;
        throw error;
      });
    }
    return this.connecting;
  }

  private async connectWithFallback(): Promise<Client> {
    const target = new URL(this.url);

    try {
      const client = new Client({ name: "falorb", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(target, { requestInit: this.requestInit });
      await client.connect(transport);
      this.client = client;
      return client;
    } catch (streamableError) {
      try {
        const client = new Client({ name: "falorb", version: "0.1.0" });
        const transport = new SSEClientTransport(target, { requestInit: this.requestInit });
        await client.connect(transport);
        this.client = client;
        return client;
      } catch (sseError) {
        throw new McpConnectorError(`Could not connect to the MCP server at ${this.url}.`, {
          streamableHttp: describeError(streamableError),
          sse: describeError(sseError),
        });
      }
    }
  }

  /** Every tool the server currently advertises. */
  async listTools(): Promise<McpToolSummary[]> {
    const client = await this.ensureConnected();
    try {
      const { tools } = await client.listTools(undefined, { timeout: this.timeoutMs });
      return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    } catch (error) {
      throw new McpConnectorError("Could not list tools on this MCP server.", error);
    }
  }

  /** Calls one tool by its exact name, as returned by `listTools`. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const client = await this.ensureConnected();
    let result: unknown;
    try {
      result = await client.callTool({ name, arguments: args }, undefined, { timeout: this.timeoutMs });
    } catch (error) {
      throw new McpConnectorError(`MCP tool "${name}" failed.`, error);
    }
    // `callTool`'s return type also covers task-augmented (call-now,
    // fetch-later) results, which have no `content` array — this client
    // never requests task mode, so that shape should never occur, but the
    // type system can't discriminate the union from the call site alone,
    // hence the runtime check.
    if (!hasToolContent(result)) {
      throw new McpConnectorError(`MCP tool "${name}" returned a task-based result, which isn't supported here.`);
    }
    if (result.isError) {
      throw new McpConnectorError(`MCP tool "${name}" returned an error.`, result.content);
    }
    return parseToolResult(result);
  }

  /**
   * No universal health endpoint exists across MCP servers — listing tools
   * is the cheapest authenticated call that proves the connection works
   * without side effects, and doubles as the freshness check for the cached
   * tool list callers store alongside a connection.
   */
  async verifyConnection(): Promise<{ ok: boolean; detail: string; tools?: McpToolSummary[] }> {
    try {
      const tools = await this.listTools();
      return { ok: true, detail: `Reachable — ${tools.length} tool(s) available.`, tools };
    } catch (error) {
      if (error instanceof McpConnectorError) return { ok: false, detail: error.message };
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connecting = null;
    }
  }
}

export function hasToolContent(
  result: unknown,
): result is { content: Array<{ type: string; text?: string }>; isError?: boolean } {
  return typeof result === "object" && result !== null && Array.isArray((result as { content?: unknown }).content);
}

export function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.find((c) => c.type === "text")?.text;
  if (text === undefined) {
    // Some tools return only non-text content (images, resources); hand the
    // raw content array back rather than failing a call that succeeded.
    return result.content;
  }
  try {
    return JSON.parse(text);
  } catch {
    // Some tools return a plain-text summary rather than JSON.
    return text;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
