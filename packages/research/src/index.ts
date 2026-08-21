/**
 * Falorb's web-research integration: Exa (search) and Firecrawl (scrape),
 * each a per-organization connection stored in `integrationConnections` —
 * the same shape as Linki, Bund AI, and Clay (`packages/linki-client`,
 * `packages/bund-ai-client`, `packages/clay-client`), connected from
 * Settings → Integrations. There is no platform-wide key: an organization
 * that hasn't connected either sees research features degrade gracefully
 * rather than reading a secret from the environment.
 *
 * The two providers are fallbacks for each other, never used together for
 * one request — `search`/`fetchPage` in `orchestrate.ts` are the only
 * exports here for that reason; `ExaClient`/`FirecrawlClient` are exported
 * so a caller can build a `ResearchClients` bag from stored connections
 * (`apps/web/src/server/integrations.ts`'s `getResearchClients`), but the
 * orchestration functions are what every feature should actually call.
 *
 * Lives in its own package for the same reason `@falorb/linki-client` and
 * `@falorb/bund-ai-client` do: it reads a decrypted credential and makes
 * outbound network calls, so it must never end up in the browser-bundled
 * `@falorb/core`. Import only from server-side code (behind
 * `apps/web/src/server`, or the worker).
 *
 * `property-profile.ts` is the one caller-facing feature built directly on
 * top of `fetchPage` plus `@falorb/ai`'s `complete()` rather than living in
 * `apps/web/src/server` like `company-research.ts` does — it has to, since
 * the `property-profiler` worker job needs the same crawl-and-summarize
 * logic the manual "Re-crawl" dashboard action does, and the worker cannot
 * import anything under `apps/web/src/server` (Next-specific, "server-only").
 */
export { ExaClient, ExaApiError, EXA_DEFAULT_BASE_URL, type ExaSearchResult, type ExaContentsResult } from "./exa";
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
export {
  researchProperty,
  parsePropertyProfile,
  PropertyResearchError,
  type PropertyProfileResult,
} from "./property-profile";
