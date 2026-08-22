import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { decryptCredential, encryptCredential, schema, type Database } from "@falorb/db";
import { McpConnectorClient } from "@falorb/mcp-connector";
import type { McpContext } from "../context";
import { requireLocalOperator } from "../context";
import { ago, failure, table, text } from "../format";

/**
 * Managing which remote MCP servers this organization has connected — the
 * management half of `@falorb/agents`'s `mcp` toolkit (`list_mcp_tools`/
 * `call_mcp_tool`), which is what actually calls a connected server's tools
 * on an agent's behalf. Same shape as `tools/integrations.ts`: a read tool
 * anyone can call, and write tools gated to `requireLocalOperator` for the
 * identical reason — connecting a credential (even an optional one, here) is
 * a materially different, higher-trust act than using one that's already
 * connected, refused to every bearer API key the same way the dashboard's
 * own API refuses it via `requireHumanSession`.
 *
 * A separate table (`mcpConnections`) rather than a new `integrationConnections`
 * provider, because an organization can connect arbitrarily many, arbitrarily
 * named MCP servers — a cardinality `integrationConnections`' one-row-per-
 * provider uniqueness doesn't fit. See `packages/db/src/schema/mcp.ts`.
 */
export function registerMcpConnectionTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_mcp_servers",
    {
      title: "Connected MCP servers",
      description:
        "Every remote MCP server this organization has connected, its status, and how many tools " +
        "it currently advertises. Never returns the stored token.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const rows = await db
          .select()
          .from(schema.mcpConnections)
          .where(eq(schema.mcpConnections.organizationId, scope.organizationId))
          .orderBy(schema.mcpConnections.name);

        return text(
          table(
            rows,
            [
              { header: "Name", get: (r) => r.name },
              { header: "URL", get: (r) => r.url },
              { header: "Status", get: (r) => (r.revokedAt ? "revoked" : r.status) },
              { header: "Tools", get: (r) => r.toolsCache?.length ?? "—" },
              { header: "Last verified", get: (r) => (r.lastVerifiedAt ? ago(r.lastVerifiedAt.toISOString()) : "—") },
              { header: "Last error", get: (r) => r.lastError },
            ],
            "No MCP servers connected yet. Connect one with connect_mcp_server.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "connect_mcp_server",
    {
      title: "Connect (or reconnect) an MCP server",
      description:
        "Store a remote MCP server's URL and, if it needs one, a bearer token — verified on the " +
        "spot by listing its tools. Reconnecting the same name rotates the stored row. Local " +
        "operator only (stdio): refused to every bearer API key, the same rule the dashboard's own " +
        "API enforces for this action.",
      inputSchema: {
        name: z.string().min(1).describe("A label for this server, unique per organization — e.g. \"Notion\"."),
        url: z.string().url().describe("The server's MCP endpoint (Streamable HTTP or SSE)."),
        api_key: z.string().optional().describe("Bearer token, if the server requires one."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, url, api_key }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, `connect the "${name}" MCP server`);

        const check = await new McpConnectorClient({ url, apiKey: api_key }).verifyConnection();
        let encrypted: { ciphertext: string; iv: string; authTag: string } | null = null;
        if (api_key) {
          try {
            encrypted = encryptCredential(api_key);
          } catch (error) {
            return failure(message(error));
          }
        }

        const [row] = await db
          .insert(schema.mcpConnections)
          .values({
            organizationId: scope.organizationId,
            name,
            url,
            encryptedApiKey: encrypted?.ciphertext ?? null,
            iv: encrypted?.iv ?? null,
            authTag: encrypted?.authTag ?? null,
            status: check.ok ? "active" : "error",
            lastVerifiedAt: check.ok ? new Date() : null,
            lastError: check.ok ? null : check.detail,
            toolsCache: check.tools ?? null,
            toolsCachedAt: check.ok ? new Date() : null,
          })
          .onConflictDoUpdate({
            target: [schema.mcpConnections.organizationId, schema.mcpConnections.name],
            targetWhere: sql`${schema.mcpConnections.revokedAt} is null`,
            set: {
              url,
              encryptedApiKey: encrypted?.ciphertext ?? null,
              iv: encrypted?.iv ?? null,
              authTag: encrypted?.authTag ?? null,
              status: check.ok ? "active" : "error",
              lastVerifiedAt: check.ok ? new Date() : null,
              lastError: check.ok ? null : check.detail,
              toolsCache: check.tools ?? null,
              toolsCachedAt: check.ok ? new Date() : null,
              revokedAt: null,
              updatedAt: new Date(),
            },
          })
          .returning({ id: schema.mcpConnections.id });

        if (!check.ok) {
          return failure(`Saved, but couldn't reach it: ${check.detail} (connection id \`${row!.id}\`).`);
        }
        return text(`"${name}" connected. ${check.detail}`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "test_mcp_server_connection",
    {
      title: "Test a connected MCP server",
      description:
        "Re-verify a connected server right now and refresh its cached tool list. Local operator " +
        "only (stdio) — same rule as connect_mcp_server.",
      inputSchema: { name: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ name }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, `test the "${name}" MCP server`);
        const row = await findByName(db, scope.organizationId, name);
        if (!row) return failure(`No MCP server named "${name}".`);
        if (row.status === "revoked" || row.revokedAt) return failure("This connection has been revoked.");

        const apiKey = row.encryptedApiKey && row.iv && row.authTag
          ? decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag })
          : undefined;
        const check = await new McpConnectorClient({ url: row.url, apiKey }).verifyConnection();

        await db
          .update(schema.mcpConnections)
          .set({
            status: check.ok ? "active" : "error",
            lastVerifiedAt: check.ok ? new Date() : row.lastVerifiedAt,
            lastError: check.ok ? null : check.detail,
            ...(check.ok ? { toolsCache: check.tools ?? row.toolsCache, toolsCachedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.mcpConnections.id, row.id));

        return check.ok ? text(check.detail) : failure(check.detail);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "revoke_mcp_server_connection",
    {
      title: "Revoke a connected MCP server",
      description:
        "Mark a connected server revoked. The row and its credential (if any) stay for audit " +
        "purposes, but no agent can call it anymore. Local operator only (stdio) — same rule as " +
        "connect_mcp_server.",
      inputSchema: { name: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, `revoke the "${name}" MCP server`);
        const [revoked] = await db
          .update(schema.mcpConnections)
          .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(schema.mcpConnections.organizationId, scope.organizationId),
              eq(schema.mcpConnections.name, name),
              isNull(schema.mcpConnections.revokedAt),
            ),
          )
          .returning();
        if (!revoked) return failure(`No MCP server named "${name}" to revoke.`);

        return text(`"${name}" disconnected.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

async function findByName(db: Database, organizationId: string, name: string) {
  const [row] = await db
    .select()
    .from(schema.mcpConnections)
    .where(and(eq(schema.mcpConnections.organizationId, organizationId), eq(schema.mcpConnections.name, name)))
    .limit(1);
  return row ?? null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
