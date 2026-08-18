import { defineConfig } from "vitest/config";

/**
 * Vitest scope for the dashboard.
 *
 * Exists to keep Vitest out of `e2e/`. Its default glob is `**\/*.spec.ts`,
 * which matches the Playwright suite — and Playwright's `test.describe()` and
 * `test.afterAll()` throw immediately when called outside the Playwright
 * runner. The result is four hard failures in `pnpm -r test` that look like
 * broken tests but are only the wrong runner picking up the wrong files.
 *
 * The two suites answer different questions and are run separately on purpose:
 *
 *   pnpm test   unit tests, no services required, runs in CI on every push
 *   pnpm e2e    Playwright against a real server and two live databases
 *
 * Most screens here are server-rendered against ClickHouse and Postgres, so
 * the assertions worth writing need a browser and live in `e2e/`. What belongs
 * in this suite is the pure logic those screens depend on — `lib/` — where a
 * wrong answer is silent rather than a failed render. `--passWithNoTests`
 * remains so a package with only e2e coverage does not fail the run.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**", "test-results/**"],
  },
});
