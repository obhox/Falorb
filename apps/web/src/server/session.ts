import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, ensureWorkspace, schema, type Workspace } from "@falorb/db";
import { auth } from "./auth";

/**
 * Session and tenancy resolution for server components.
 *
 * Every read in the dashboard is scoped by organization, and the scope has to
 * come from the session rather than from the URL — otherwise editing a project
 * slug in the address bar would read another tenant's data. `requireSession`
 * is the single place that resolution happens.
 *
 * Wrapped in React's `cache` so one render pass resolves the session and its
 * project list once, no matter how many components ask. A page with a shell,
 * a header and four panels would otherwise issue five identical session
 * lookups and five identical project queries.
 */

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
}

export type ProjectRow = typeof schema.projects.$inferSelect;

export interface DashboardSession {
  user: SessionUser;
  workspace: Workspace;
  /** Active, non-archived projects in this organization. */
  projects: ProjectRow[];
}

export const getSession = cache(async (): Promise<DashboardSession | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  const database = db();
  const workspace = await ensureWorkspace(database, session.user);

  const projects = await database
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.organizationId, workspace.organizationId),
        isNull(schema.projects.archivedAt),
      ),
    )
    .orderBy(schema.projects.name);

  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email,
    },
    workspace,
    projects,
  };
});

/** Same, but sends anonymous callers to sign-in instead of returning null. */
export async function requireSession(): Promise<DashboardSession> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

/**
 * Resolve a project slug within the caller's organization.
 *
 * Returns null rather than throwing on a miss, and — importantly — a slug that
 * belongs to a different tenant simply does not match, so it is
 * indistinguishable from a slug that does not exist. That is the intended
 * behaviour: a 404 leaks nothing about what other organizations have named
 * their projects.
 */
export async function requireProject(slug: string): Promise<{
  session: DashboardSession;
  project: ProjectRow;
}> {
  const session = await requireSession();
  const project = session.projects.find((p) => p.slug === slug);
  if (!project) notFound();
  return { session, project };
}
