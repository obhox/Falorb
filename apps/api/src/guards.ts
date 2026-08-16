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
 * *what a credential may do*, and role answers *what a person may do*. All
 * three are separate checks and a mutating route needs at least the first two.
 */

export interface ScopedContext {
  get: ((k: "workspace") => Workspace | null) & ((k: "scopes") => string[]);
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
 * Refuse an operation to a bearer API key, whatever its scopes.
 *
 * Some acts are not "writes" in the sense a scope can express: minting another
 * credential, or destroying data irreversibly. A leaked key that can mint keys
 * turns one leak into indefinite persistence, and revoking the original does
 * not revoke its offspring. A leaked key that can erase a person destroys
 * data no backup restores cleanly. Both require a human session.
 */
export function requireHumanSession(
  c: { get: (k: "workspace") => Workspace | null },
  action: string,
): Workspace {
  const workspace = requireAuth(c);
  if (workspace.role === "api_key") {
    throw new HttpError(403, `An API key cannot ${action}. Sign in to the dashboard to do this.`);
  }
  return workspace;
}
