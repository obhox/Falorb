import "server-only";
import { and, eq } from "drizzle-orm";
import { db, decryptCredential, schema } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";

/**
 * Builds a typed client from a stored `integrationConnections` row, for
 * server actions that take a real action on Linki/Bund AI (not just reading
 * the mirror). Returns null when the org has never connected, or has
 * revoked/errored — callers turn that into "connect it in Settings" rather
 * than a stack trace.
 */

async function activeConnection(organizationId: string, provider: "linki" | "bund_ai") {
  const [row] = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        eq(schema.integrationConnections.provider, provider),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getLinkiClient(organizationId: string): Promise<LinkiClient | null> {
  const row = await activeConnection(organizationId, "linki");
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new LinkiClient({ baseUrl: row.baseUrl, apiKey });
}

export async function getBundAiClient(organizationId: string): Promise<BundAiClient | null> {
  const row = await activeConnection(organizationId, "bund_ai");
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new BundAiClient({ baseUrl: row.baseUrl, apiKey });
}
