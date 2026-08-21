import "server-only";
import { and, eq } from "drizzle-orm";
import { db, decryptCredential, schema } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { ExaClient, FirecrawlClient, type ResearchClients } from "@falorb/research";

/**
 * Builds a typed client from a stored `integrationConnections` row, for
 * server actions that take a real action on Linki/Bund AI (not just reading
 * the mirror) or research on Exa/Firecrawl's behalf. Returns null when the
 * org has never connected, or has revoked/errored — callers turn that into
 * "connect it in Settings" rather than a stack trace. Clay and ElevenLabs
 * have no equivalent getter here — nothing in the web app calls either
 * directly; only `apps/worker/src/jobs/clay-enrichment.ts`/`ugc-video-gen.ts`
 * do, and each builds its own client from the connection row.
 */

async function activeConnection(
  organizationId: string,
  provider: "linki" | "bund_ai" | "exa" | "firecrawl",
) {
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

/**
 * Builds `@falorb/research`'s `ResearchClients` bag from whichever of
 * Exa/Firecrawl this organization has connected — either, both, or neither.
 * `search`/`fetchPage` (`@falorb/research`) treat a `null` entry as "no
 * connection" and fall back to the other provider, so this never throws for
 * an org that hasn't connected one or either.
 */
export async function getResearchClients(organizationId: string): Promise<ResearchClients> {
  const [exaRow, firecrawlRow] = await Promise.all([
    activeConnection(organizationId, "exa"),
    activeConnection(organizationId, "firecrawl"),
  ]);

  return {
    exa: exaRow
      ? new ExaClient({
          baseUrl: exaRow.baseUrl,
          apiKey: decryptCredential({ ciphertext: exaRow.encryptedApiKey, iv: exaRow.iv, authTag: exaRow.authTag }),
        })
      : null,
    firecrawl: firecrawlRow
      ? new FirecrawlClient({
          baseUrl: firecrawlRow.baseUrl,
          apiKey: decryptCredential({
            ciphertext: firecrawlRow.encryptedApiKey,
            iv: firecrawlRow.iv,
            authTag: firecrawlRow.authTag,
          }),
        })
      : null,
  };
}

export interface ConnectionView {
  provider: "linki" | "bund_ai" | "clay" | "exa" | "firecrawl" | "elevenlabs";
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
