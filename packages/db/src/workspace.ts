import { and, asc, eq } from "drizzle-orm";
import { generatePublicKey } from "./api-keys";
import * as schema from "./schema/index";
import type { Database } from "./index";

/**
 * Turning a fresh signup into a usable workspace.
 *
 * Organization creation is lazy rather than hooked into the signup flow. A
 * database hook that fails takes the whole registration down with it, leaving
 * an account that cannot be recovered without manual intervention; resolving
 * on first authenticated request instead means a transient failure is simply
 * retried on the next call. It also handles accounts created before this code
 * existed, and users invited into someone else's organization.
 */

export interface Workspace {
  organizationId: string;
  organizationName: string;
  role: string;
}

/** One row per workspace the caller belongs to, for rendering the switcher. */
export interface WorkspaceSummary {
  organizationId: string;
  organizationName: string;
  slug: string;
  role: string;
}

/**
 * Every workspace this user is a member of, oldest membership first.
 *
 * Ordered so the list is stable between renders — a switcher whose entries
 * reshuffle on every navigation is worse than no switcher.
 */
export async function listWorkspaces(
  db: Database,
  userId: string,
): Promise<WorkspaceSummary[]> {
  return db
    .select({
      organizationId: schema.memberships.organizationId,
      organizationName: schema.organizations.name,
      slug: schema.organizations.slug,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.id));
}

/**
 * Record which workspace a user is looking at.
 *
 * Returns false when they are not a member, having written nothing. That check
 * is the whole security surface of the switcher: the organization id arrives
 * from a form post, so it is an attacker-controlled string, and the only thing
 * separating "change my view" from "read another tenant" is that a membership
 * must exist. It is deliberately verified here, next to the write, rather than
 * left to the caller — a second call site that forgot would be a tenancy
 * breach rather than a missing feature.
 */
export async function setActiveWorkspace(
  db: Database,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const [membership] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!membership) return false;

  await db
    .update(schema.user)
    .set({ activeOrganizationId: organizationId, updatedAt: new Date() })
    .where(eq(schema.user.id, userId));

  return true;
}

export async function ensureWorkspace(
  db: Database,
  user: { id: string; name?: string | null; email: string },
): Promise<Workspace> {
  const memberships = await db
    .select({
      organizationId: schema.memberships.organizationId,
      role: schema.memberships.role,
      organizationName: schema.organizations.name,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, user.id))
    /**
     * Ordered, because picking a row without one is not a choice — it is
     * whatever Postgres happens to return, and that can change between requests
     * after a vacuum or a plan change. A user who belongs to two organizations
     * (which is exactly what accepting an invitation creates) was being
     * resolved into an arbitrary one, and the role came from the same arbitrary
     * row: someone who is a viewer in one workspace and an owner in another
     * could be evaluated as either.
     *
     * Oldest membership first, so the fallback below is stable and the
     * workspace someone created for themselves stays their default until they
     * choose otherwise. `id` breaks ties if two memberships share a timestamp.
     */
    .orderBy(asc(schema.memberships.createdAt), asc(schema.memberships.id));

  if (memberships.length) {
    /**
     * Honour the stored preference, but only as a *hint*. The active id is
     * re-checked against the membership list on every single resolution rather
     * than trusted, so being removed from a workspace takes effect on the next
     * request: the stored id stops matching and the caller falls back to one
     * they are genuinely in. The column is never the thing that grants access.
     */
    const [{ activeOrganizationId } = { activeOrganizationId: null }] = await db
      .select({ activeOrganizationId: schema.user.activeOrganizationId })
      .from(schema.user)
      .where(eq(schema.user.id, user.id))
      .limit(1);

    const active = activeOrganizationId
      ? memberships.find((m) => m.organizationId === activeOrganizationId)
      : undefined;

    const existing = active ?? memberships[0]!;

    return {
      organizationId: existing.organizationId,
      organizationName: existing.organizationName,
      role: existing.role,
    };
  }

  const baseName = user.name?.trim() || user.email.split("@")[0] || "Workspace";
  const slug = await uniqueSlug(db, slugify(baseName));

  const workspace = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(schema.organizations)
      .values({ name: `${baseName}'s workspace`, slug })
      .returning();

    await tx.insert(schema.memberships).values({
      organizationId: org!.id,
      userId: user.id,
      role: "owner",
    });

    return { organizationId: org!.id, organizationName: org!.name, role: "owner" };
  });

  return workspace;
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

/**
 * Find a free slug by suffixing.
 *
 * Bounded rather than looping forever: after a handful of collisions it falls
 * back to a random suffix, which cannot collide in practice and avoids an
 * unbounded query loop if something pathological is happening.
 */
async function uniqueSlug(db: Database, base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface CreateProjectInput {
  organizationId: string;
  name: string;
  slug?: string;
  domains?: string[];
  timezone?: string;
  identityScope?: "project" | "org";
}

export async function createProject(db: Database, input: CreateProjectInput) {
  const slug = await uniqueProjectSlug(db, input.organizationId, slugify(input.slug || input.name));

  const [project] = await db
    .insert(schema.projects)
    .values({
      organizationId: input.organizationId,
      name: input.name,
      slug,
      // Stored without protocol or www so the Origin check has one canonical
      // form to compare against.
      domains: (input.domains ?? []).map(normalizeDomain).filter(Boolean),
      publicKey: generatePublicKey(),
      timezone: input.timezone ?? "UTC",
      identityScope: input.identityScope ?? "org",
    })
    .returning();

  return project!;
}

async function uniqueProjectSlug(
  db: Database,
  organizationId: string,
  base: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(eq(schema.projects.organizationId, organizationId), eq(schema.projects.slug, candidate)),
      )
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}
