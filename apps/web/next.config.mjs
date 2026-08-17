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

  // What makes the app deployable. `next start` against a plain `.next` needs
  // the node_modules layout it was built with, and the production image copies
  // the build out of the workspace into a flat /app — so the two disagreed and
  // every route 500'd on an unresolvable external. Standalone output traces
  // exactly the files the server needs and emits its own node_modules, which
  // survives being moved. See infra/docker/Dockerfile.web.
  output: "standalone",

  // Pinned to the monorepo root. A stray lockfile in a parent directory makes
  // Next infer the workspace root wrongly, and standalone output then traces
  // files from the wrong tree.
  outputFileTracingRoot: root,

  // The tracer copies @swc/helpers' cjs build and stops, but the compiled
  // server requires the esm one — so a standalone image died on startup with
  // "Cannot find module .../@swc/helpers/esm/_interop_require_default.js".
  // Nothing in the app imports this directly; it is Next's own runtime
  // dependency, which is why static analysis misses it.
  outputFileTracingIncludes: {
    "/**": ["../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**"],
  },

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

  /**
   * Transport and framing hardening.
   *
   * These live in the app rather than only in `infra/Caddyfile` because the
   * Caddyfile is not on the production path — the stack in
   * `infra/docker-compose.production.yml` publishes through Coolify's proxy and
   * never loads it, so headers configured there were being assumed present and
   * were in fact absent. Headers set here follow the app into any deployment.
   *
   * The Content-Security-Policy is deliberately *not* here: it carries a
   * per-request nonce and so must be generated in `src/middleware.ts`.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()",
          },
          // The dashboard renders one customer's data at a time; isolating the
          // browsing context keeps a malicious opener or embedder from probing
          // it through shared process state.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
