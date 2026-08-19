import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { schema } from "@falorb/db";
import type { McpContext } from "../context";
import { requireScope } from "../context";
import { ago, failure, table, text } from "../format";

const ROLES = ["owner", "admin", "member", "viewer"] as const;
const INVITE_TTL_DAYS = 7;

function appOrigin(): string {
  return (process.env.FALORB_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Workspace membership. Mirrors the safety rails in
 * `apps/web/src/server/actions/team.ts` exactly — never orphan a workspace
 * by demoting or removing its last owner — because an assistant acting on a
 * misread instruction should be caught by the same guard a person is.
 */
export function registerTeamTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_team",
    {
      title: "List workspace members",
      description: "Members and pending invitations for this organization.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const { db, scope } = ctx();
      try {
        const [members, invitations] = await Promise.all([
          db
            .select({
              userId: schema.memberships.userId,
              name: schema.user.name,
              email: schema.user.email,
              role: schema.memberships.role,
              joinedAt: schema.memberships.createdAt,
            })
            .from(schema.memberships)
            .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
            .where(eq(schema.memberships.organizationId, scope.organizationId))
            .orderBy(schema.memberships.createdAt),
          db
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
                eq(schema.invitations.organizationId, scope.organizationId),
                isNull(schema.invitations.acceptedAt),
                isNull(schema.invitations.revokedAt),
                gt(schema.invitations.expiresAt, new Date()),
              ),
            )
            .orderBy(desc(schema.invitations.createdAt)),
        ]);

        return text(
          `### Members\n` +
            table(members, [
              { header: "Name", get: (r) => r.name ?? "—" },
              { header: "Email", get: (r) => r.email },
              { header: "Role", get: (r) => r.role },
              { header: "Joined", get: (r) => ago(r.joinedAt.toISOString()) },
            ]) +
            `\n\n### Pending invitations\n` +
            table(
              invitations,
              [
                { header: "Id", get: (r) => r.id },
                { header: "Email", get: (r) => r.email },
                { header: "Role", get: (r) => r.role },
                { header: "Expires", get: (r) => ago(r.expiresAt.toISOString()) },
              ],
              "None.",
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "invite_member",
    {
      title: "Invite someone to the workspace",
      description:
        "Invite by email, as admin or lower — an invite mints a seat for someone not yet present to check against, so owners are promoted deliberately by an existing owner rather than invited directly. Returns a one-time link; only its hash is stored. Requires the write scope.",
      inputSchema: {
        email: z.string().email(),
        role: z.enum(["admin", "member", "viewer"]).optional().default("member"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ email, role }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const normalized = email.trim().toLowerCase();

        const [already] = await db
          .select({ id: schema.memberships.id })
          .from(schema.memberships)
          .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
          .where(and(eq(schema.memberships.organizationId, scope.organizationId), eq(schema.user.email, normalized)))
          .limit(1);
        if (already) return failure(`${normalized} is already in this workspace.`);

        await db
          .update(schema.invitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.invitations.organizationId, scope.organizationId),
              eq(schema.invitations.email, normalized),
              isNull(schema.invitations.acceptedAt),
              isNull(schema.invitations.revokedAt),
            ),
          );

        const token = randomBytes(32).toString("base64url");
        await db.insert(schema.invitations).values({
          organizationId: scope.organizationId,
          email: normalized,
          role,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        });

        return text(`Invited ${normalized} as ${role}: ${appOrigin()}/invite/${token}\n\nExpires in ${INVITE_TTL_DAYS} days.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "revoke_invitation",
    {
      title: "Revoke a pending invitation",
      description: "Withdraw an outstanding invite before it's accepted. Requires the write scope.",
      inputSchema: { invitation_id: z.string().describe("From list_team.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ invitation_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [revoked] = await db
          .update(schema.invitations)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.invitations.id, invitation_id), eq(schema.invitations.organizationId, scope.organizationId)))
          .returning();
        if (!revoked) return failure("No such invitation.");
        return text(`Revoked the invitation for ${revoked.email}.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "change_member_role",
    {
      title: "Change a member's role",
      description: "Promote or demote a member. Refuses to demote the workspace's only owner. Requires the write scope.",
      inputSchema: {
        user_id: z.string().describe("From list_team."),
        role: z.enum(ROLES),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ user_id, role }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const owners = await ownerIds(db, scope.organizationId);
        if (owners.length === 1 && owners[0] === user_id && role !== "owner") {
          return failure("This is the only owner. Promote someone else to owner first.");
        }

        const [updated] = await db
          .update(schema.memberships)
          .set({ role })
          .where(and(eq(schema.memberships.userId, user_id), eq(schema.memberships.organizationId, scope.organizationId)))
          .returning();

        if (!updated) return failure("That person is not a member.");
        return text(`Role updated to ${role}.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "remove_member",
    {
      title: "Remove a member from the workspace",
      description: "Remove someone from the workspace. Refuses to remove the only owner. Requires the write scope.",
      inputSchema: { user_id: z.string().describe("From list_team.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ user_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");

        const owners = await ownerIds(db, scope.organizationId);
        if (owners.length === 1 && owners[0] === user_id) {
          return failure("Cannot remove the only owner. Promote someone else first.");
        }

        const [removed] = await db
          .delete(schema.memberships)
          .where(and(eq(schema.memberships.userId, user_id), eq(schema.memberships.organizationId, scope.organizationId)))
          .returning();

        if (!removed) return failure("That person is not a member.");
        return text("Removed from the workspace.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

async function ownerIds(db: McpContext["db"], organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.role, "owner")));
  return rows.map((r) => r.userId);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
