import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  AuthError,
  createClients,
  resolveScope,
  type McpContext,
  type Scope,
} from "./context";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server";

/**
 * Entry point for both transports.
 *
 *   stdio — the assistant launches this process directly (Claude Desktop,
 *   Claude Code, any local MCP client). Trusted local context.
 *
 *   --http — a long-lived server other people's assistants connect to over the
 *   network. Every request must carry an API key, and each connection gets its
 *   own scope so two organizations can never see each other's data.
 */

const useHttp = process.argv.includes("--http") || process.env.FALORB_MCP_HTTP === "1";

const { db, clickhouse } = createClients();

async function main(): Promise<void> {
  if (useHttp) await startHttp();
  else await startStdio();
}

async function startStdio(): Promise<void> {
  const scope = await resolveScope(db, process.env.FALORB_API_KEY, { requireKey: false });

  const context: McpContext = { db, clickhouse, scope };
  const server = buildServer(() => context);

  await server.connect(new StdioServerTransport());
  // stdout is the transport itself — any stray write there corrupts the
  // protocol stream, so all logging must go to stderr.
  console.error(
    `[mcp] ${SERVER_NAME} v${SERVER_VERSION} on stdio — ${scope.label}, ${scope.projects.length} projects`,
  );
}

async function startHttp(): Promise<void> {
  const port = Number(process.env.FALORB_MCP_PORT ?? 3002);

  const http = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      console.error("[mcp] request failed:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    });
  });

  http.listen(port, () => {
    console.error(
      `[mcp] ${SERVER_NAME} v${SERVER_VERSION} on http://localhost:${port}/mcp — bearer API key required`,
    );
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION }));
    return;
  }

  if (url.pathname !== "/mcp") {
    res.writeHead(404).end();
    return;
  }

  // CORS so browser-based MCP clients can connect. `mcp-session-id` must be
  // exposed or the client cannot read it back off the response.
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  let scope: Scope;
  try {
    scope = await resolveScope(db, bearerToken(req), { requireKey: true });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : 500;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32001, message: error instanceof Error ? error.message : "unauthorized" },
        id: null,
      }),
    );
    return;
  }

  // A fresh server and transport per request, in stateless mode.
  //
  // Sharing one server across connections would mean sharing one scope, and
  // the first caller's organization would leak into every subsequent request.
  // Building per request keeps tenant isolation structural rather than
  // something the tool code has to remember.
  const context: McpContext = { db, clickhouse, scope };
  const server = buildServer(() => context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

async function shutdown(signal: string): Promise<void> {
  console.error(`[mcp] ${signal} received`);
  await clickhouse.close().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Unique id per process, useful when several instances run behind a proxy.
process.env.FALORB_MCP_INSTANCE ??= randomUUID().slice(0, 8);

await main();
