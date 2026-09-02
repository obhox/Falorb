import { and, eq } from "drizzle-orm";
import { decryptCredential, resolveOAuthAccessToken, schema, type Database } from "@falorb/db";
import { McpConnectorClient } from "@falorb/mcp-connector";

/**
 * Every MCP server this organization has connected and not revoked. Used by
 * `list_mcp_tools` to enumerate what's available — never includes the
 * credential.
 */
export async function listMcpConnections(db: Database, organizationId: string) {
  return db
    .select()
    .from(schema.mcpConnections)
    .where(
      and(
        eq(schema.mcpConnections.organizationId, organizationId),
        eq(schema.mcpConnections.status, "active"),
      ),
    )
    .orderBy(schema.mcpConnections.name);
}

/**
 * One connection by id, scoped to the organization — `call_mcp_tool` looks
 * this up fresh on every call rather than trusting a cached client, since a
 * connection can be revoked between an approval being raised and it being
 * carried out.
 */
export async function getMcpConnection(db: Database, organizationId: string, connectionId: string) {
  const [row] = await db
    .select()
    .from(schema.mcpConnections)
    .where(
      and(
        eq(schema.mcpConnections.id, connectionId),
        eq(schema.mcpConnections.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Builds a live client for a connection row already loaded via
 * `getMcpConnection`. Async because an `authMode: "oauth"` row may need a
 * fresh access token — `resolveOAuthAccessToken` refreshes and persists one
 * when the stored one has expired, so an OAuth-connected server works here
 * exactly as it does from the dashboard's own "Test" button, not just there.
 */
export async function mcpClientFor(
  db: Database,
  row: {
    id: string;
    url: string;
    authMode: "api_key" | "oauth";
    encryptedApiKey: string | null;
    iv: string | null;
    authTag: string | null;
    encryptedOAuth: string | null;
    oauthIv: string | null;
    oauthAuthTag: string | null;
  },
): Promise<McpConnectorClient> {
  const apiKey =
    row.authMode === "oauth"
      ? await resolveOAuthAccessToken(db, row)
      : row.encryptedApiKey && row.iv && row.authTag
        ? decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag })
        : undefined;
  return new McpConnectorClient({ url: row.url, apiKey });
}
