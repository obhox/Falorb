import type { ClickHouseClient } from "@clickhouse/client";
import { and, eq, isNull } from "drizzle-orm";
import {
  can,
  createClickHouse,
  createDatabase,
  schema,
  verifyApiKey,
  type Database,
} from "@falorb/db";

/**
 * Request scope and tenancy.
 *
 * Every tool in this server reads analytics data, so the single most important
 * property is that a caller can only ever see projects belonging to their own
 * organization. That is enforced in one place: `resolveScope` produces the set
 * of allowed project ids, and no tool constructs a project list any other way.
 *
 * Tools take a project *slug* rather than an id precisely so this holds — an
 * id supplied by the caller is never trusted, it is looked up within the
 * already-scoped set.
 */

export interface ProjectInfo {
  id: number;
  slug: string;
  name: string;
  domains: string[];
  timezone: string;
  /** What this property does, crawled from its own homepage — null until
   * the `property-profiler` worker job (or a manual "Re-crawl") has run.
   * See `packages/db/src/schema/tenancy.ts`'s `profileSummary` column. */
  profileSummary: string | null;
}

export interface Scope {
  organizationId: string;
  /** Every project the caller may read. */
  projects: ProjectInfo[];
  projectIds: number[];
  scopes: string[];
  /**
   * The membership role this caller acts with — `api_keys.role` for a bearer
   * key, `owner` for the stdio local operator.
   *
   * Tools used to authorise on `scopes` alone, which meant `write` was
   * effectively `owner`: `change_member_role` could promote anyone, and
   * `archive_project` could hide a property, both of which the dashboard
   * reserves for owners. Scope says read-or-write; this says whether the
   * holder is entitled to that class of change. `requireCapability` checks it
   * against the same `can.*` predicates the dashboard's `deny` helper uses.
   */
  role: string;
  /** Label for logs and the server instructions. */
  label: string;
  /**
   * True only for the stdio fallback (no API key; the operator running this
   * process already holds direct database credentials). False for every
   * bearer-key caller, local or remote.
   *
   * A handful of tools require this rather than just the `write` scope —
   * storing/testing/revoking an integration credential, and requesting a
   * person's GDPR erasure — mirroring `requireHumanSession` in
   * `apps/api/src/routes/{integrations,people}.ts`, which refuses those same
   * actions to *any* bearer key, including "the read-only keys users hand to
   * AI assistants, which is exactly how [person erasure] became reachable
   * without any check at all" (that route's own words). A stdio operator
   * already has the database credentials to do either directly, so gating
   * them here adds no real protection for that case; a bearer key — the
   * shape every remote MCP client authenticates with — is exactly the case
   * those two routes were written to exclude.
   */
  isLocalOperator: boolean;
}

export interface McpContext {
  db: Database;
  clickhouse: ClickHouseClient;
  scope: Scope;
}

export class AuthError extends Error {}
export class ScopeError extends Error {}

export function createClients(): { db: Database; clickhouse: ClickHouseClient } {
  return { db: createDatabase(), clickhouse: createClickHouse() };
}

async function loadProjects(db: Database, organizationId: string): Promise<ProjectInfo[]> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, organizationId), isNull(schema.projects.archivedAt)),
    );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    domains: r.domains ?? [],
    profileSummary: r.profileSummary,
    timezone: r.timezone,
  }));
}

/**
 * Resolve a caller to a scope.
 *
 * An API key is required over HTTP, where the server is reachable by anyone.
 * Over stdio the process is launched by the operator on their own machine with
 * direct database credentials already in the environment, so a key is optional
 * — but if one is present it is still honoured, which keeps the two transports
 * behaving identically when it matters.
 */
export async function resolveScope(
  db: Database,
  apiKey: string | undefined,
  options: { requireKey: boolean },
): Promise<Scope> {
  if (apiKey) {
    const verified = await verifyApiKey(db, apiKey);
    if (!verified) throw new AuthError("Invalid, revoked, or expired API key.");

    let projects = await loadProjects(db, verified.organizationId);

    // A key bound to one project may only ever see that project.
    if (verified.projectId !== null) {
      projects = projects.filter((p) => p.id === verified.projectId);
    }

    return {
      organizationId: verified.organizationId,
      projects,
      projectIds: projects.map((p) => p.id),
      scopes: verified.scopes.length ? verified.scopes : ["read"],
      role: verified.role,
      label: `api key ${verified.id.slice(0, 8)}`,
      isLocalOperator: false,
    };
  }

  if (options.requireKey) {
    throw new AuthError(
      "Missing API key. Send it as `Authorization: Bearer <key>`. Create one in Falorb under Settings → API keys.",
    );
  }

  /**
   * stdio fallback: the local operator, scoped to the only organization.
   *
   * "The first organization" was fine while an install meant one tenant. On a
   * multi-tenant install it silently bound the assistant to whichever row came
   * back first — an arbitrary customer's data, with read *and write* scope,
   * and no indication that a choice had been made. Ambiguity is refused
   * instead: with more than one organization the operator must say which, by
   * setting a key.
   */
  const orgs = await db.select().from(schema.organizations).limit(2);
  if (!orgs.length) throw new AuthError("No organization exists yet. Run the seed first.");
  if (orgs.length > 1) {
    throw new AuthError(
      "This install has more than one organization, so the target is ambiguous. " +
        "Set FALORB_API_KEY to the key of the workspace you mean.",
    );
  }
  const org = orgs[0]!;

  const projects = await loadProjects(db, org.id);
  return {
    organizationId: org.id,
    projects,
    projectIds: projects.map((p) => p.id),
    scopes: ["read", "write"],
    // The operator launched this process with the database credentials already
    // in their environment; a capability check cannot contain someone who can
    // write the rows directly, and pretending otherwise would only make the
    // local transport behave differently from the dashboard for no gain.
    role: "owner",
    label: `local stdio (${org.name})`,
    isLocalOperator: true,
  };
}

export function hasScope(scope: Scope, required: string): boolean {
  return scope.scopes.includes("*") || scope.scopes.includes(required);
}

export function requireScope(scope: Scope, required: string): void {
  if (!hasScope(scope, required)) {
    throw new ScopeError(
      `This action needs the "${required}" scope; this API key has [${scope.scopes.join(", ")}].`,
    );
  }
}

/**
 * Refuse an action the caller's *role* does not reach.
 *
 * The companion to `requireScope`, and both are needed: scope bounds what the
 * credential may do, role bounds what its holder is entitled to. The
 * capability names come from `@falorb/db`'s `can`, which is also what the
 * dashboard's server actions check — so a tool here and the button that does
 * the same thing there cannot drift into permitting different things. Before
 * this existed every tool in this server authorised on scope alone, and a
 * `write` key could do anything the dashboard reserved for an owner.
 */
export function requireCapability(
  scope: Scope,
  capability: keyof typeof can,
  action: string,
): void {
  if (!can[capability](scope.role)) {
    throw new ScopeError(
      `This credential's role is "${scope.role}", which cannot ${action} — the same rule the ` +
        "dashboard enforces for this action. Ask an owner or admin, or use a key issued with a " +
        "higher role.",
    );
  }
}

/**
 * Refuse a bearer API key outright, regardless of its scopes — see the
 * `isLocalOperator` docblock on `Scope`. Used only where the dashboard's own
 * API refuses every bearer key the same way (`requireHumanSession`).
 */
export function requireLocalOperator(scope: Scope, action: string): void {
  if (!scope.isLocalOperator) {
    throw new ScopeError(
      `An API key cannot ${action}, the same rule the dashboard's own API enforces for this action — ` +
        "sign in to the dashboard to do this, or run this server over stdio as the local operator.",
    );
  }
}

/**
 * Resolve a project argument to ids the caller is allowed to read.
 *
 * `undefined` or "all" means the whole portfolio, which is what makes the
 * cross-project questions answerable in one call.
 */
export function resolveProjects(scope: Scope, project: string | undefined): number[] {
  if (!scope.projectIds.length) {
    throw new ScopeError("This API key has access to no projects.");
  }
  if (!project || project.toLowerCase() === "all") return scope.projectIds;

  const wanted = project.toLowerCase();
  const match = scope.projects.find(
    (p) => p.slug.toLowerCase() === wanted || String(p.id) === wanted,
  );
  if (!match) {
    const available = scope.projects.map((p) => p.slug).join(", ");
    throw new ScopeError(`Unknown project "${project}". Available: ${available || "none"}.`);
  }
  return [match.id];
}

export function projectName(scope: Scope, id: number): string {
  return scope.projects.find((p) => p.id === id)?.slug ?? `project ${id}`;
}
