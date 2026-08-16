import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * Public, read-only sharing of a property's summary.
 *
 * The `dashboards` table already carried a `publicToken` column with a unique
 * index and no code behind it. This uses it as designed — one row per shared
 * property, `projectId` set, token non-null while the link is live — rather
 * than inventing a second sharing table.
 *
 * What a token grants is deliberately narrow: the headline figures and the
 * aggregate breakdowns for **one** property. No person-level data, no session
 * list, no other property, no settings. Anyone holding the link is anonymous
 * and unauthenticated, so the safe assumption is that the link will eventually
 * be forwarded further than intended.
 *
 * The token is a bearer capability stored in plaintext. Hashing it would be
 * stronger against a database reader, but the link has to remain *displayable*
 * — people expect to reopen the settings page and copy the same URL again —
 * and a hash cannot be shown twice. The mitigation is entropy plus easy
 * revocation: 32 random bytes is not guessable, and one click invalidates it.
 */

const TOKEN_BYTES = 32;

export type DashboardRow = typeof schema.dashboards.$inferSelect;

/** The live share for a project, or null when it is not shared. */
export async function getShare(
  organizationId: string,
  projectId: number,
): Promise<DashboardRow | null> {
  const [row] = await db()
    .select()
    .from(schema.dashboards)
    .where(
      and(
        eq(schema.dashboards.organizationId, organizationId),
        eq(schema.dashboards.projectId, projectId),
        isNotNull(schema.dashboards.publicToken),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Issue a link, or rotate the existing one.
 *
 * Rotating rather than returning the current token on every call is what makes
 * "the link got out" recoverable: re-sharing mints a new token and the old URL
 * stops resolving immediately.
 */
export async function shareProject(
  organizationId: string,
  projectId: number,
  createdBy: string,
  name: string,
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const database = db();

  const [existing] = await database
    .select()
    .from(schema.dashboards)
    .where(
      and(
        eq(schema.dashboards.organizationId, organizationId),
        eq(schema.dashboards.projectId, projectId),
      ),
    )
    .limit(1);

  if (existing) {
    await database
      .update(schema.dashboards)
      .set({ publicToken: token, updatedAt: new Date() })
      .where(eq(schema.dashboards.id, existing.id));
    return token;
  }

  await database.insert(schema.dashboards).values({
    organizationId,
    projectId,
    name: `${name} — public`,
    publicToken: token,
    createdBy,
  });

  return token;
}

/** Revoke the link. The row survives so re-sharing does not lose its name. */
export async function unshareProject(
  organizationId: string,
  projectId: number,
): Promise<boolean> {
  const [updated] = await db()
    .update(schema.dashboards)
    .set({ publicToken: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.dashboards.organizationId, organizationId),
        eq(schema.dashboards.projectId, projectId),
      ),
    )
    .returning();

  return Boolean(updated);
}

export interface SharedProject {
  projectId: number;
  projectName: string;
  domain: string | null;
  timezone: string;
}

/**
 * Resolve a token to the one property it exposes.
 *
 * Returns null for an unknown, revoked or malformed token — the caller renders
 * the same not-found page for all three, so a probe cannot distinguish "never
 * existed" from "was revoked".
 */
export async function resolveShare(token: string): Promise<SharedProject | null> {
  // Bounded before it reaches the database: the column is indexed and unique,
  // and an arbitrarily long string is a pointless query.
  if (!token || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;

  const [row] = await db()
    .select({
      projectId: schema.projects.id,
      projectName: schema.projects.name,
      domains: schema.projects.domains,
      timezone: schema.projects.timezone,
      archivedAt: schema.projects.archivedAt,
    })
    .from(schema.dashboards)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.dashboards.projectId))
    .where(eq(schema.dashboards.publicToken, token))
    .limit(1);

  // An archived property stops resolving; otherwise a link outlives the thing
  // it points at and keeps serving figures for something taken out of service.
  if (!row || row.archivedAt) return null;

  return {
    projectId: row.projectId,
    projectName: row.projectName,
    domain: row.domains[0] ?? null,
    timezone: row.timezone,
  };
}
