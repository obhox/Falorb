import type { Metadata } from "next";
import { Card } from "@falorb/ui";
import { can, ROLE_DESCRIPTIONS, ROLE_LABELS, MEMBER_ROLES } from "@falorb/db";
import { requireSession } from "@/server/session";
import { getTeam } from "@/server/team";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { TeamPanel, type InvitationView, type TeamMemberView } from "./TeamPanel";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

/**
 * Who is in the workspace, and what each of them may do.
 *
 * Roles are workspace-wide rather than per-property, matching the schema: a
 * membership names an organization, not a project. Per-property roles would be
 * a different data model, and pretending to offer them in the UI while storing
 * one role would be worse than not offering them.
 */
export default async function TeamPage() {
  const session = await requireSession();
  const team = await getTeam(session.workspace.organizationId);
  const now = Date.now();

  const members: TeamMemberView[] = team.members.map((member) => ({
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    isYou: member.userId === session.user.id,
  }));

  const invitations: InvitationView[] = team.invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    invitedByEmail: invitation.invitedByEmail,
  }));

  return (
    <>
      <PageHeader
        title="Team"
        meta={`${ROLE_LABELS[session.workspace.role as keyof typeof ROLE_LABELS] ?? session.workspace.role} · ${session.workspace.organizationName}`}
      />

      <PageBody>
        <TeamPanel
          members={members}
          invitations={invitations}
          canManage={can.manageTeam(session.workspace.role)}
          canAssign={can.assignRole(session.workspace.role)}
          ownerCount={team.ownerCount}
          now={now}
        />

        <Card title="What each role can do" subtitle="Roles apply to every property in the workspace">
          <div style={{ display: "grid", gap: 1 }}>
            {MEMBER_ROLES.map((role) => (
              <div
                key={role}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px minmax(0, 1fr)",
                  gap: 12,
                  minHeight: "var(--row-height)",
                  alignItems: "center",
                  borderBottom: "1px solid var(--grid-line)",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--size-body-sm)",
                    color:
                      role === session.workspace.role
                        ? "var(--text-primary)"
                        : "var(--text-secondary)",
                    fontWeight:
                      role === session.workspace.role
                        ? "var(--wt-semibold)"
                        : "var(--wt-regular)",
                  }}
                >
                  {ROLE_LABELS[role]}
                </span>
                <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
                  {ROLE_DESCRIPTIONS[role]}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </PageBody>
    </>
  );
}
