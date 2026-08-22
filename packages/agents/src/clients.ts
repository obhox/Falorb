import { and, eq, isNull } from "drizzle-orm";
import { decryptCredential, schema, type Database } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { McpConnectorClient } from "@falorb/mcp-connector";

/**
 * Typed clients for the products an agent can act on, built from the stored
 * `integrationConnections` credential.
 *
 * Org-level connections only. A project-level override exists in the schema
 * and `apps/web/src/server/integrations.ts` honours it, but neither Linki nor
 * Bund AI holds project-scoped data — the same reasoning
 * `apps/worker/src/jobs/linki-sync.ts` gives for mirroring org-level rows
 * only. An agent acting per-property against a second credential would write
 * into a workspace whose mirror it cannot read.
 *
 * Returns null rather than throwing when nothing is connected, so a tool can
 * tell the agent "Linki isn't connected — hand this to a human" and have it
 * do something sensible, instead of the run dying on a stack trace.
 */

async function activeConnection(
  db: Database,
  organizationId: string,
  provider: "linki" | "bund_ai",
) {
  const [row] = await db
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, provider),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getLinkiClient(
  db: Database,
  organizationId: string,
): Promise<LinkiClient | null> {
  const row = await activeConnection(db, organizationId, "linki");
  if (!row) return null;
  return new LinkiClient({
    baseUrl: row.baseUrl,
    apiKey: decryptCredential({
      ciphertext: row.encryptedApiKey,
      iv: row.iv,
      authTag: row.authTag,
    }),
  });
}

export async function getBundAiClient(
  db: Database,
  organizationId: string,
): Promise<BundAiClient | null> {
  const row = await activeConnection(db, organizationId, "bund_ai");
  if (!row) return null;
  return new BundAiClient({
    baseUrl: row.baseUrl,
    apiKey: decryptCredential({
      ciphertext: row.encryptedApiKey,
      iv: row.iv,
      authTag: row.authTag,
    }),
  });
}

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

/** Builds a live client for a connection row already loaded via `getMcpConnection`. */
export function mcpClientFor(row: {
  url: string;
  encryptedApiKey: string | null;
  iv: string | null;
  authTag: string | null;
}): McpConnectorClient {
  const apiKey =
    row.encryptedApiKey && row.iv && row.authTag
      ? decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag })
      : undefined;
  return new McpConnectorClient({ url: row.url, apiKey });
}
