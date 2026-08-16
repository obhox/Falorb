import { createAuth } from "@falorb/auth";

/**
 * The API's better-auth instance.
 *
 * The configuration itself moved to `@falorb/auth` when the dashboard needed to
 * read sessions server-side. Both apps must agree exactly on secret, cookie
 * and field mapping or they stop honouring each other's sessions, so the only
 * thing that varies per app is the origin it is mounted on.
 */
export const auth = createAuth({
  baseURL: process.env.FALORB_API_URL ?? "http://localhost:3003",
});

export type AuthSession = typeof auth.$Infer.Session;
