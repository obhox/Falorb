import "server-only";
import { and, eq } from "drizzle-orm";
import { db, decryptCredential, schema } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { BufferClient } from "@falorb/buffer-client";

/**
 * Builds a typed client from a stored `integrationConnections` row, for
 * server actions that take a real action on Linki/Bund AI/Buffer (not just
 * reading the mirror). Returns null when the org has never connected, or has
 * revoked/errored — callers turn that into "connect it in Settings" rather
 * than a stack trace. Clay has no equivalent getter here — nothing in the
 * web app calls Clay directly; only `apps/worker/src/jobs/clay-enrichment.ts`
 * does, and it builds its own `ClayClient` from the connection row.
 */

async function activeConnection(organizationId: string, provider: "linki" | "bund_ai" | "buffer") {
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

export async function getBufferClient(organizationId: string): Promise<BufferClient | null> {
  const row = await activeConnection(organizationId, "buffer");
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new BufferClient({ baseUrl: row.baseUrl, apiKey });
}

export interface ConnectionView {
  provider: "linki" | "bund_ai" | "buffer" | "clay";
  baseUrl: string;
  status: "active" | "revoked" | "error";
  lastVerifiedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

/** For the Settings → Integrations page. Never returns key material — there is nothing here safe to display. */
export async function listConnections(organizationId: string): Promise<ConnectionView[]> {
  const rows = await db()
    .select()
    .from(schema.integrationConnections)
    .where(eq(schema.integrationConnections.organizationId, organizationId));

  return rows.map((r) => ({
    provider: r.provider,
    baseUrl: r.baseUrl,
    status: r.status,
    lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastError: r.lastError,
    updatedAt: r.updatedAt.toISOString(),
  }));
}
