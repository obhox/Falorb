import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, schema, type Database } from "@falorb/db";
import { Mailer, inviteMail } from "@falorb/mailer";
import type { Workspace } from "../onboarding";
import { HttpError } from "../http";

/**
 * Team membership and invitations.
 *
 * The invite token is generated once, emailed, and stored only as a hash — a
 * database dump therefore hands out no workspace access. Acceptance requires
 * being signed in as the invited address, so possession of the link alone is
 * not enough: forwarding it to a colleague does not silently grant them
 * someone else's seat.
 */

type Vars = {
  userId: string | null;
  workspace: Workspace | null;
  scopes: string[];
};

const INVITE_TTL_DAYS = 7;

/** Roles that may manage the team. */
const ADMIN_ROLES = new Set(["owner", "admin"]);

export function teamRoutes(db: Database, mailer: Mailer): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  const requireAdmin = (c: { get: (k: "workspace") => Workspace | null }): Workspace => {
    const workspace = c.get("workspace");
    if (!workspace) throw new HttpError(401, "Sign in first.");
    if (!ADMIN_ROLES.has(workspace.role)) {
      throw new HttpError(403, "Only an owner or admin can manage the team.");
    }
    return workspace;
  };

  app.get("/members", async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) throw new HttpError(401, "Sign in first.");

    const members = await db
      .select({
        userId: schema.memberships.userId,
        role: schema.memberships.role,
        joinedAt: schema.memberships.createdAt,
        name: schema.user.name,
        email: schema.user.email,
      })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, workspace.organizationId));

    const pending = await db
      .select({
        id: schema.invitations.id,
        email: schema.invitations.email,
        role: schema.invitations.role,
        expiresAt: schema.invitations.expiresAt,
        createdAt: schema.invitations.createdAt,
      })
      .from(schema.invitations)
      .where(
        and(
          eq(schema.invitations.organizationId, workspace.organizationId),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
          gt(schema.invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.invitations.createdAt));

    return c.json({ members, pendingInvitations: pending });
  });

  const inviteSchema = z.object({
    email: z.string().email().max(320),
    role: z.enum(["admin", "member", "viewer"]).optional().default("member"),
  });

  app.post("/invitations", async (c) => {
    const workspace = requireAdmin(c);
    const parsed = inviteSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(422, "A valid email address is required.");

    const email = parsed.data.email.toLowerCase().trim();

    // Already a member: report it plainly rather than sending an invite that
    // would do nothing on acceptance.
    const [existing] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.organizationId, workspace.organizationId),
          eq(schema.user.email, email),
        ),
      )
      .limit(1);
    if (existing) throw new HttpError(409, `${email} is already a member of this workspace.`);

    // Supersede any outstanding invite for this address, so a re-invite always
    // means exactly one live token.
    await db
      .update(schema.invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.invitations.organizationId, workspace.organizationId),
          eq(schema.invitations.email, email),
          isNull(schema.invitations.acceptedAt),
          isNull(schema.invitations.revokedAt),
        ),
      );

    const token = randomBytes(32).toString("base64url");
    const [invitation] = await db
      .insert(schema.invitations)
      .values({
        organizationId: workspace.organizationId,
        email,
        role: parsed.data.role,
        tokenHash: hashToken(token),
        invitedBy: c.get("userId"),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      })
      .returning();

    const appUrl = process.env.FALORB_APP_URL ?? "http://localhost:3000";
    const url = `${appUrl}/invite/${token}`;

    const [inviter] = c.get("userId")
      ? await db
          .select({ name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.id, c.get("userId")!))
          .limit(1)
      : [];

    const sent = await mailer.send(
      inviteMail(email, workspace.organizationName, inviter?.name ?? "A teammate", url),
    );

    audit(db, {
      organizationId: workspace.organizationId,
      actorId: c.get("userId"),
      action: AUDIT_ACTIONS.memberInvited,
      targetType: "invitation",
      targetId: invitation!.id,
      metadata: { email, role: parsed.data.role, emailSent: sent },
    });

    return c.json(
      {
        id: invitation!.id,
        email,
        role: parsed.data.role,
        expiresAt: invitation!.expiresAt,
        emailSent: sent && mailer.isConfigured,
        // Returned only when email cannot be delivered, so an install without
        // a provider can still onboard a team by passing the link along.
        ...(mailer.isConfigured ? {} : { url, note: "No email provider configured — share this link manually." }),
      },
      201,
    );
  });

  app.post("/invitations/accept", async (c) => {
    const userId = c.get("userId");
    if (!userId) throw new HttpError(401, "Sign in to accept an invitation.");

    const body = await c.req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) throw new HttpError(422, "An invitation token is required.");

    const [invitation] = await db
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

    if (!invitation) throw new HttpError(404, "That invitation is invalid, expired, or already used.");

    const [account] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    // The token alone is not authority. Binding acceptance to the invited
    // address means a forwarded link cannot hand a stranger a seat.
    if (account?.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new HttpError(
        403,
        `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.memberships)
        .values({
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
        })
        .onConflictDoNothing();

      await tx
        .update(schema.invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invitations.id, invitation.id));
    });

    audit(db, {
      organizationId: invitation.organizationId,
      actorId: userId,
      action: AUDIT_ACTIONS.memberJoined,
      targetType: "user",
      targetId: userId,
      metadata: { role: invitation.role },
    });

    return c.json({ joined: true, organizationId: invitation.organizationId, role: invitation.role });
  });

  app.delete("/invitations/:id", async (c) => {
    const workspace = requireAdmin(c);
    const [revoked] = await db
      .update(schema.invitations)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.invitations.id, c.req.param("id")),
          eq(schema.invitations.organizationId, workspace.organizationId),
        ),
      )
      .returning();

    if (!revoked) throw new HttpError(404, "No such invitation.");
    return c.json({ revoked: true });
  });

  app.delete("/members/:userId", async (c) => {
    const workspace = requireAdmin(c);
    const targetId = c.req.param("userId");

    const owners = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, workspace.organizationId),
          eq(schema.memberships.role, "owner"),
        ),
      );

    // Removing the last owner would leave the workspace unadministrable, with
    // no way back short of direct database access.
    if (owners.length === 1 && owners[0]!.userId === targetId) {
      throw new HttpError(409, "Cannot remove the only owner. Promote another member first.");
    }

    const [removed] = await db
      .delete(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, workspace.organizationId),
          eq(schema.memberships.userId, targetId),
        ),
      )
      .returning();

    if (!removed) throw new HttpError(404, "That person is not a member.");

    audit(db, {
      organizationId: workspace.organizationId,
      actorId: c.get("userId"),
      action: AUDIT_ACTIONS.memberRemoved,
      targetType: "user",
      targetId,
    });

    return c.json({ removed: true });
  });

  return app;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
