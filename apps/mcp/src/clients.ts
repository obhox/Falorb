import { and, eq, isNull } from "drizzle-orm";
import { decryptCredential, schema, type Database } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { BufferClient } from "@falorb/buffer-client";

/**
 * Typed clients for the products a write tool acts on, built from the stored
 * `integrationConnections` credential — the same shape
 * `packages/agents/src/clients.ts` uses for the agent runtime.
 *
 * Org-level connections only, deliberately: none of Linki, Bund AI or
 * Buffer's mirror tables carry a project dimension (§13 of FEATURES.md), so
 * a project-scoped override would have nothing local to reconcile against.
 * Returns null rather than throwing when nothing is connected, so a tool can
 * give a clear "not connected" failure instead of an unhandled exception.
 */

async function activeConnection(
  db: Database,
  organizationId: string,
  provider: "linki" | "bund_ai" | "buffer",
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

export async function getLinkiClient(db: Database, organizationId: string): Promise<LinkiClient | null> {
  const row = await activeConnection(db, organizationId, "linki");
  if (!row) return null;
  return new LinkiClient({
    baseUrl: row.baseUrl,
    apiKey: decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag }),
  });
}

export async function getBundAiClient(db: Database, organizationId: string): Promise<BundAiClient | null> {
  const row = await activeConnection(db, organizationId, "bund_ai");
  if (!row) return null;
  return new BundAiClient({
    baseUrl: row.baseUrl,
    apiKey: decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag }),
  });
}

export async function getBufferClient(db: Database, organizationId: string): Promise<BufferClient | null> {
  const row = await activeConnection(db, organizationId, "buffer");
  if (!row) return null;
  return new BufferClient({
    baseUrl: row.baseUrl,
    apiKey: decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag }),
  });
}
