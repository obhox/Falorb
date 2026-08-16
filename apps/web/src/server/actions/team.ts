"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { can, db, isMemberRole, schema, type MemberRole } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";

/**
 * Team mutations.
 *
 * Every one of these re-reads the caller's role from the session on the server
 * and refuses before touching a row. The UI also hides the controls a role
 * cannot use, but that is a courtesy — a server action is a public endpoint,
 * reachable by anyone who can post to it, so hiding a button is not a check.
 */

const INVITE_TTL_DAYS = 7;

export interface InviteResult extends ActionResult {
  /** The link to pass on. Shown once; only its hash is stored. */
  url?: string;
}

export async function inviteMember(formData: FormData): Promise<InviteResult> {
  const session = await requireSession();

  if (!can.manageTeam(session.workspace.role)) {
    return { ok: false, message: "Only an owner or admin can invite people." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const role = asRole(formData.get("role"), "member");
  if (role === "owner") {
    // An invite mints a seat for someone who is not yet present to be checked
    // against; owners are promoted deliberately, by an existing owner.
    return { ok: false, message: "Invite as admin or lower, then promote once they have joined." };
  }

  const database = db();

  const [already] = await database
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.organizationId, session.workspace.organizationId),
        eq(schema.user.email, email),
      ),
    )
    .limit(1);

  if (already) {
    return { ok: false, message: `${email} is already in this workspace.` };
  }

  // Supersede any outstanding invite for this address, so re-inviting always
  // leaves exactly one live token rather than two working links.
  await database
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invitations.organizationId, session.workspace.organizationId),
        eq(schema.invitations.email, email),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
      ),
    );

  const token = randomBytes(32).toString("base64url");

  await database.insert(schema.invitations).values({
    organizationId: session.workspace.organizationId,
    email,
    role,
    // Only the hash is stored, so a leaked database hands out no access.
    tokenHash: hashToken(token),
    invitedBy: session.user.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  });

  revalidatePath("/settings/team");

  const origin = process.env.FALORB_APP_URL ?? "http://localhost:3000";
  return {
    ok: true,
    message: `Invited ${email}`,
    // Returned so it can be passed on by hand. Whether a mailer is configured
    // is not this action's concern, and an invite that exists only in an email
    // nobody received is worse than one the inviter can copy.
    url: `${origin.replace(/\/$/, "")}/invite/${token}`,
  };
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!can.manageTeam(session.workspace.role)) {
    return { ok: false, message: "Only an owner or admin can manage invitations." };
  }

  const [revoked] = await db()
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invitations.id, invitationId),
        eq(schema.invitations.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!revoked) return { ok: false, message: "No such invitation." };

  revalidatePath("/settings/team");
  return { ok: true, message: "Invitation revoked" };
}

export async function changeMemberRole(
  userId: string,
  nextRole: string,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!can.assignRole(session.workspace.role)) {
    return { ok: false, message: "Only an owner can change roles." };
  }
  if (!isMemberRole(nextRole)) {
    return { ok: false, message: "Unknown role." };
  }

  const database = db();
  const owners = await ownerIds(session.workspace.organizationId);

  // Demoting the last owner leaves nobody able to assign roles or remove
  // members — a workspace that can only be repaired with database access.
  if (owners.length === 1 && owners[0] === userId && nextRole !== "owner") {
    return {
      ok: false,
      message: "This is the only owner. Promote someone else to owner first.",
    };
  }

  const [updated] = await database
    .update(schema.memberships)
    .set({ role: nextRole })
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!updated) return { ok: false, message: "That person is not a member." };

  revalidatePath("/settings/team");
  return { ok: true, message: "Role updated" };
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const session = await requireSession();

  if (!can.manageTeam(session.workspace.role)) {
    return { ok: false, message: "Only an owner or admin can remove people." };
  }

  const owners = await ownerIds(session.workspace.organizationId);

  if (owners.length === 1 && owners[0] === userId) {
    return { ok: false, message: "Cannot remove the only owner. Promote someone else first." };
  }

  // An admin removing an owner would be a privilege inversion: the lesser role
  // deciding the greater one's membership.
  if (owners.includes(userId) && !can.assignRole(session.workspace.role)) {
    return { ok: false, message: "Only an owner can remove another owner." };
  }

  const [removed] = await db()
    .delete(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!removed) return { ok: false, message: "That person is not a member." };

  revalidatePath("/settings/team");
  return { ok: true, message: "Removed from the workspace" };
}

async function ownerIds(organizationId: string): Promise<string[]> {
  const rows = await db()
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.role, "owner"),
      ),
    );
  return rows.map((row) => row.userId);
}

function asRole(value: FormDataEntryValue | null, fallback: MemberRole): MemberRole {
  const text = String(value ?? "");
  return isMemberRole(text) ? text : fallback;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
