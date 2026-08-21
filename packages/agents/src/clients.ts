import { and, eq, isNull } from "drizzle-orm";
import { decryptCredential, schema, type Database } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";

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
