import type { ClickHouseClient } from "@clickhouse/client";
import { and, eq, isNull } from "drizzle-orm";
import {
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
}

export interface Scope {
  organizationId: string;
  /** Every project the caller may read. */
  projects: ProjectInfo[];
  projectIds: number[];
  scopes: string[];
  /** Label for logs and the server instructions. */
  label: string;
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
      label: `api key ${verified.id.slice(0, 8)}`,
    };
  }

  if (options.requireKey) {
    throw new AuthError(
      "Missing API key. Send it as `Authorization: Bearer <key>`. Create one in Falorb under Settings → API keys.",
    );
  }

  // stdio fallback: the local operator, scoped to the first organization.
  const [org] = await db.select().from(schema.organizations).limit(1);
  if (!org) throw new AuthError("No organization exists yet. Run the seed first.");

  const projects = await loadProjects(db, org.id);
  return {
    organizationId: org.id,
    projects,
    projectIds: projects.map((p) => p.id),
    scopes: ["read", "write"],
    label: `local stdio (${org.name})`,
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
