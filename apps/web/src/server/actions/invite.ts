"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";

/**
 * Accepting an invitation.
 *
 * Deliberately not guarded by a role check — the whole point is that the caller
 * has no role in this workspace yet. What stands in for one is the token, and
 * the three conditions checked alongside it: live, unexpired, and issued to the
 * address the caller is signed in as.
 */
export async function acceptInvitation(token: string): Promise<ActionResult> {
  const session = await requireSession();
  const database = db();

  const [invitation] = await database
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.tokenHash, hashToken(token)),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
        gt(schema.invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!invitation) {
    return { ok: false, message: "This invitation is no longer valid." };
  }

  /**
   * The address must be *proven*, not merely claimed.
   *
   * Matching the session's email alone was enough only while every account had
   * necessarily confirmed its address — and that is not guaranteed:
   * `requireEmailVerification` is derived from whether a mailer is configured,
   * so an install without `RESEND_API_KEY` signs people up unverified and
   * auto-signs them in. On such an install, anyone who learned an invited
   * address could register it and claim the seat, up to and including admin.
   * Reading `emailVerified` here makes the binding hold regardless of how the
   * install is configured.
   */
  const [account] = await database
    .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  if (!account?.emailVerified) {
    return {
      ok: false,
      message: "Confirm your email address before joining a workspace.",
    };
  }

  // The binding that makes a forwarded link worthless.
  if (invitation.email.toLowerCase() !== account.email.toLowerCase()) {
    return {
      ok: false,
      message: `This invitation was issued to ${invitation.email}.`,
    };
  }

  const [already] = await database
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, invitation.organizationId),
        eq(schema.memberships.userId, session.user.id),
      ),
    )
    .limit(1);

  // Marking the invitation used even when the membership already exists keeps a
  // stale link from lingering as a live token.
  if (already) {
    await database
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invitations.id, invitation.id));
    return { ok: true, message: "You are already in this workspace." };
  }

  // One transaction: a membership without the invitation being consumed would
  // leave a token that can be replayed, and a consumed invitation without a
  // membership would strand the person with no way back in.
  await database.transaction(async (tx) => {
    await tx.insert(schema.memberships).values({
      organizationId: invitation.organizationId,
      userId: session.user.id,
      role: invitation.role,
    });

    await tx
      .update(schema.invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.invitations.id, invitation.id));
  });

  revalidatePath("/");
  revalidatePath("/settings/team");
  return { ok: true, message: "Joined" };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
