import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The workspace keeps one `.env` at the monorepo root — it is what
 * `turbo.json` declares as a global dependency, and what ingest, the worker and
 * the API all read. Next only looks inside its own app directory, so without
 * this the dashboard builds and boots with no DATABASE_URL and no
 * BETTER_AUTH_SECRET, and better-auth silently falls back to a default secret
 * that would invalidate every session the API issued.
 *
 * Values already in the environment win, so a real deployment's injected
 * variables are never overwritten by a checked-out file.
 */
const rootEnv = resolve(root, ".env");
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Pinned to the monorepo root. A stray lockfile in a parent directory makes
  // Next infer the workspace root wrongly, and standalone output then traces
  // files from the wrong tree.
  outputFileTracingRoot: root,

  // Workspace packages ship TypeScript and JSX source rather than build output,
  // so Next has to compile them itself.
  transpilePackages: ["@falorb/ui", "@falorb/queries", "@falorb/db", "@falorb/core", "@falorb/auth"],

  // Native and connection-pooling libraries must stay outside the bundle: the
  // pools are process-wide singletons and bundling them creates a fresh pool
  // per compiled route, which exhausts Postgres in development.
  serverExternalPackages: ["postgres", "pg", "@clickhouse/client", "better-auth"],

  experimental: {
    // The dashboard's figures are dense enough that a stale render is
    // misleading. Pages opt into caching explicitly instead.
    staleTimes: { dynamic: 0, static: 30 },
  },

  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
