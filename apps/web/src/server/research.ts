import "server-only";

/**
 * Thin, server-only re-export of `@falorb/research`. Same boundary
 * `src/server/ai.ts` draws for `@falorb/ai`: every import site inside
 * `apps/web` goes through `src/server` so secret-holding code never reaches
 * the client bundle.
 */
export {
  ExaApiError,
  FirecrawlApiError,
  scrapeUrl,
  searchWeb,
  type ExaSearchResult,
  type FirecrawlScrapeResult,
} from "@falorb/research";
