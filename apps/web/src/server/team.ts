import "server-only";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema, type MemberRole } from "@falorb/db";

/**
 * Reading the workspace's people.
 *
 * Members and pending invitations are separate concepts and are kept separate:
 * an invitation is a claim on a seat, not a seat. Merging them into one list
 * would make "3 members" mean something different depending on how many people
 * happened not to have clicked their link yet.
 */

export interface TeamMember {
  userId: string;
  name: string | null;
  email: string;
  role: MemberRole;
  joinedAt: Date;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: Date;
  createdAt: Date;
  invitedByEmail: string | null;
}

export interface Team {
  members: TeamMember[];
  invitations: PendingInvitation[];
  /** Owners, so the UI can refuse to strip the last one. */
  ownerCount: number;
}

export async function getTeam(organizationId: string): Promise<Team> {
  const database = db();

  const [members, invitations] = await Promise.all([
    database
      .select({
        userId: schema.memberships.userId,
        name: schema.user.name,
        email: schema.user.email,
        role: schema.memberships.role,
        joinedAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, organizationId))
      .orderBy(schema.memberships.createdAt),

    database
      .select({
        id: schema.invitations.id,
        email: schema.invitations.email,
        role: schema.invitations.role,
        expiresAt: schema.invitations.expiresAt,
        createdAt: schema.invitations.createdAt,
        invitedByEmail: schema.user.email,
      })
      .from(schema.invitations)
      .leftJoin(schema.user, eq(schema.user.id, schema.invitations.invitedBy))
      .where(
        and(
          eq(schema.invitations.organizationId, organizationId),
          // Only live claims: accepted ones became memberships, revoked ones
          // were withdrawn, and expired ones no longer resolve.
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
          gt(schema.invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.invitations.createdAt)),
  ]);

  return {
    members: members as TeamMember[],
    invitations: invitations as PendingInvitation[],
    ownerCount: members.filter((member) => member.role === "owner").length,
  };
}
