/**
 * Workspace and project bootstrapping.
 *
 * The implementation moved into `@falorb/db` when the dashboard needed the same
 * logic — it resolves a session to an organization on every server render, and
 * duplicating "create the org lazily on first authenticated request" in two
 * places is how two apps end up creating two organizations for one user.
 *
 * Re-exported here so the API's call sites read unchanged.
 */
export {
  ensureWorkspace,
  createProject,
  normalizeDomain,
  slugify,
  type Workspace,
  type CreateProjectInput,
} from "@falorb/db";
