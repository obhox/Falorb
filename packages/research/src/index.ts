/**
 * Falorb's web-research integration: Exa (search) and Firecrawl (scrape),
 * two independent platform-level API keys the same shape as `@falorb/ai`'s
 * `OPENROUTER_API_KEY` — a secret Falorb itself holds to call a third-party
 * research API, not a per-organization connection like Linki or Bund AI
 * (`packages/db/src/schema/integrations.ts`'s `integration_connections`).
 *
 * The two providers are fallbacks for each other, never used together for
 * one request — `search`/`fetchPage` in `orchestrate.ts` are the only
 * exports here for that reason; the raw per-provider clients (`exa.ts`,
 * `firecrawl.ts`) are internal so a caller can't accidentally compose both.
 *
 * Lives in its own package for the same reason `@falorb/ai` and
 * `@falorb/mailer` do: it reads secret keys and makes outbound network
 * calls, so it must never end up in the browser-bundled `@falorb/core`.
 * Import only from server-side code (behind `apps/web/src/server`, or the
 * worker).
 */
export { ResearchUnavailableError, search, fetchPage, type ResearchResult } from "./orchestrate";
