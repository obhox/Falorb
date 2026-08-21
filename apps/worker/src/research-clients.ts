import { decryptCredential } from "@falorb/db";
import { ExaClient, FirecrawlClient, type ResearchClients } from "@falorb/research";

export interface ResearchConnectionRow {
  provider: string;
  baseUrl: string;
  encryptedApiKey: string;
  iv: string;
  authTag: string;
}

/**
 * Builds `@falorb/research`'s `ResearchClients` bag directly from stored
 * `integrationConnections` rows — the worker's counterpart to
 * `apps/web/src/server/integrations.ts`'s `getResearchClients`, which is
 * Next-specific (`"server-only"`) and cannot be imported from here. Same
 * "build the client directly from the connection row" shape
 * `clay-enrichment.ts` and `ugc-video-gen.ts` already use for their own
 * per-org providers.
 *
 * Shared by `job-listener.ts` and `property-profiler.ts`, the two
 * per-organization web-research-backed jobs.
 */
export function buildResearchClients(connections: ResearchConnectionRow[]): ResearchClients {
  const exaRow = connections.find((c) => c.provider === "exa");
  const firecrawlRow = connections.find((c) => c.provider === "firecrawl");

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
