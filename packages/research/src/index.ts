/**
 * Falorb's web-research integration: Firecrawl, a per-organization
 * connection stored in `integrationConnections` — the same shape as Linki
 * and Bund AI (`packages/linki-client`, `packages/bund-ai-client`),
 * connected from Settings → Integrations. There is no platform-wide key: an
 * organization that hasn't connected it sees research features degrade
 * gracefully rather than reading a secret from the environment.
 *
 * `search`/`fetchPage` in `orchestrate.ts` are what every feature should
 * actually call; `FirecrawlClient` is exported so a caller can build a
 * `ResearchClients` bag from stored connections
 * (`apps/web/src/server/integrations.ts`'s `getResearchClients`).
 *
 * Lives in its own package for the same reason `@falorb/linki-client` and
 * `@falorb/bund-ai-client` do: it reads a decrypted credential and makes
 * outbound network calls, so it must never end up in the browser-bundled
 * `@falorb/core`. Import only from server-side code (behind
 * `apps/web/src/server`, or the worker).
 */
export {
  FirecrawlClient,
  FirecrawlApiError,
  FIRECRAWL_DEFAULT_BASE_URL,
  type FirecrawlScrapeResult,
  type FirecrawlSearchResult,
} from "./firecrawl";
export {
  ResearchUnavailableError,
  search,
  fetchPage,
  type ResearchClients,
  type ResearchResult,
} from "./orchestrate";
