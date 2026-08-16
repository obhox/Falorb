import "server-only";
import { createAuth } from "@falorb/auth";

/**
 * The dashboard's better-auth instance.
 *
 * The dashboard mounts its own handler at `/api/auth` rather than proxying to
 * `apps/api`. Same-origin means the session cookie needs no SameSite
 * relaxation and no CORS credentials dance in production, where the API and
 * the dashboard sit on different hostnames (`a.obhox.com` / `analytics.obhox.com`).
 * Both instances share the configuration in `@falorb/auth` and the same
 * `BETTER_AUTH_SECRET`, so a session minted by either is honoured by both.
 */
export const auth = createAuth({
  baseURL: process.env.FALORB_APP_URL ?? "http://localhost:3000",
});
