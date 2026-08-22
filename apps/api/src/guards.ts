import { can } from "@falorb/db";
import { HttpError } from "./http";
import type { Workspace } from "./onboarding";

/**
 * Authentication and authorization guards, shared by every route file.
 *
 * These used to live inside `index.ts`, which meant a route mounted from
 * another file could only reach `requireAuth` — and `requireScope` was simply
 * unavailable to it. `apps/api/src/routes/people.ts` was mounted that way and
 * consequently enforced no scope at all: a key issued as read-only could merge
 * identities and queue an irreversible erasure. Sharing the guards is what
 * makes forgetting one visible rather than silent.
 *
 * The rule the API now follows: authentication answers *who*, scope answers
 * *what a credential may do*, and role answers *what its holder may do*. All
 * three are separate checks and a mutating route needs at least the first two.
 *
 * Role used to be the one this file could not express. Every signed-in caller
 * was handed `["read","write","admin"]` regardless of whether they were a
 * viewer or an owner, and an API key carried no role at all — so `write` was
 * effectively `owner` on every route that asked only for a scope. The
 * dashboard, meanwhile, enforced `can.*` on every single mutation. That gap was
 * not a missing feature, it was the role model failing to exist anywhere
 * outside one of four entry points. `requireCapability` closes it by checking
 * the *same* `can.*` predicates the dashboard's `deny` helper does, against a
 * role that now travels with both kinds of credential.
 */

/** Which kind of credential authenticated this request. */
export type Credential = "session" | "api_key";

export interface GuardContext {
  get: ((k: "workspace") => Workspace | null) &
    ((k: "scopes") => string[]) &
    ((k: "credential") => Credential | null);
}

export function requireAuth(c: { get: (k: "workspace") => Workspace | null }): Workspace {
  const workspace = c.get("workspace");
  if (!workspace) {
    throw new HttpError(401, "Sign in, or send an API key as `Authorization: Bearer`.");
  }
  return workspace;
}

export function requireScope(c: { get: (k: "scopes") => string[] }, scope: string): void {
  const scopes = c.get("scopes");
  if (!scopes.includes("*") && !scopes.includes(scope)) {
    throw new HttpError(403, `This credential lacks the "${scope}" scope.`);
  }
}

/**
 * Refuse an operation the caller's *role* does not reach.
 *
 * The capability names and their rank thresholds come from `@falorb/db`'s
 * `can`, which is also what the dashboard's server actions check — so a route
 * here and its equivalent button there cannot drift into permitting different
 * things. The message names the role required rather than saying "forbidden",
 * for the same reason the dashboard's does: the likeliest reader is a colleague
 * who needs to know who to ask.
 */
export function requireCapability(
  c: { get: (k: "workspace") => Workspace | null },
  capability: keyof typeof can,
  action: string,
): Workspace {
  const workspace = requireAuth(c);
  if (!can[capability](workspace.role)) {
    throw new HttpError(
      403,
      `Your role is "${workspace.role}", which cannot ${action}. Ask an owner or admin.`,
    );
  }
  return workspace;
}

/**
 * Refuse an operation to a bearer API key, whatever its scopes or role.
 *
 * Some acts are not "writes" in the sense a scope can express, and are not
 * simply "admin work" in the sense a role can express either: minting another
 * credential, or destroying data irreversibly. A leaked key that can mint keys
 * turns one leak into indefinite persistence, and revoking the original does
 * not revoke its offspring. A leaked key that can erase a person destroys data
 * no backup restores cleanly. Both require a human session.
 *
 * Keyed on the credential kind rather than on `role === "api_key"` as it once
 * was: a key now carries a real membership role, so the two facts are
 * independent and conflating them would mean a key's role silently disabled
 * this check.
 */
export function requireHumanSession(
  c: { get: ((k: "workspace") => Workspace | null) & ((k: "credential") => Credential | null) },
  action: string,
): Workspace {
  const workspace = requireAuth(c);
  if (c.get("credential") === "api_key") {
    throw new HttpError(403, `An API key cannot ${action}. Sign in to the dashboard to do this.`);
  }
  return workspace;
}
