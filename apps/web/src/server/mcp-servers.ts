import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export interface McpServerView {
  id: string;
  name: string;
  url: string;
  hasToken: boolean;
  status: "active" | "revoked" | "error";
  toolCount: number | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** Never selects `encryptedApiKey`/`iv`/`authTag` — nothing here is safe to display. */
export async function listMcpServers(organizationId: string): Promise<McpServerView[]> {
  const rows = await db()
    .select({
      id: schema.mcpConnections.id,
      name: schema.mcpConnections.name,
      url: schema.mcpConnections.url,
      hasToken: schema.mcpConnections.encryptedApiKey,
      status: schema.mcpConnections.status,
      toolsCache: schema.mcpConnections.toolsCache,
      lastVerifiedAt: schema.mcpConnections.lastVerifiedAt,
      lastError: schema.mcpConnections.lastError,
      createdAt: schema.mcpConnections.createdAt,
    })
    .from(schema.mcpConnections)
    .where(eq(schema.mcpConnections.organizationId, organizationId))
    .orderBy(schema.mcpConnections.name);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    hasToken: r.hasToken !== null,
    status: r.status,
    toolCount: r.toolsCache?.length ?? null,
    lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
  }));
}
