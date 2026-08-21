/**
 * Falorb's web-research integration: Exa (search) and Firecrawl (scrape),
 * two independent platform-level API keys the same shape as `@falorb/ai`'s
 * `OPENROUTER_API_KEY` — a secret Falorb itself holds to call a third-party
 * research API, not a per-organization connection like Linki or Bund AI
 * (`packages/db/src/schema/integrations.ts`'s `integration_connections`).
 *
 * Lives in its own package for the same reason `@falorb/ai` and
 * `@falorb/mailer` do: it reads secret keys and makes outbound network
 * calls, so it must never end up in the browser-bundled `@falorb/core`.
 * Import only from server-side code (behind `apps/web/src/server`, or the
 * worker).
 */
export { ExaApiError, searchWeb, type ExaSearchOptions, type ExaSearchResult } from "./exa";
export {
  FirecrawlApiError,
  scrapeUrl,
  type FirecrawlScrapeOptions,
  type FirecrawlScrapeResult,
} from "./firecrawl";
export { truncateText } from "./truncate";
