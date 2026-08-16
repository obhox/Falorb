import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * End-to-end tests over the dashboard.
 *
 * These exist because every screen in `apps/web` is server-rendered against two
 * live databases. A typecheck proves the code compiles; it cannot prove that a
 * ClickHouse column still exists, that a query returns the shape the page
 * destructures, or that the auth gate actually gates. Only a browser hitting a
 * real server does that.
 *
 * The suite runs against a real Postgres and ClickHouse — `pnpm infra:up`
 * first. It is not hermetic on purpose: mocking the stores here would test the
 * mocks, and the failures worth catching are precisely the ones where the code
 * and the data disagree.
 */

const rootEnv = resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Serial: the fixtures share one account and one seeded organization, and
  // parallel workers racing on the same rows produce failures that look like
  // product bugs.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL,
    // Every test runs signed in; the auth-gate test clears it explicitly.
    storageState: "./e2e/.auth/state.json",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Production build, not dev: dev-mode compile-on-demand makes the first
    // hit to each route slow enough to look like a hang, and React strict-mode
    // double-rendering masks effect bugs the real app would show.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // better-auth rejects any request whose Origin is not trusted, and the
      // suite runs on 127.0.0.1:3100 while the default trusts only
      // localhost:3000. Without this every sign-in fails with "Invalid origin"
      // and each test times out on a page that never authenticates — which
      // reads as the app being broken rather than the test being misconfigured.
      FALORB_TRUSTED_ORIGINS: baseURL,
      FALORB_APP_URL: baseURL,
    },
  },
});
