import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Card } from "@falorb/ui";
import { db, ROLE_DESCRIPTIONS, ROLE_LABELS, schema, type MemberRole } from "@falorb/db";
import { requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { AcceptInvite } from "./AcceptInvite";

export const metadata: Metadata = { title: "Invitation" };
export const dynamic = "force-dynamic";

/**
 * Accepting an invitation.
 *
 * Inside the authenticated group on purpose: `requireSession` sends an
 * anonymous visitor to sign in and Next returns them here afterwards, so the
 * link works whether or not the recipient already has an account.
 *
 * The token is matched by hash — the plaintext exists only in the link — and
 * acceptance is bound to the invited address. A forwarded link therefore grants
 * the forwarder nothing, which is the entire point of storing the address on
 * the invitation rather than trusting whoever opens it.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const session = await requireSession();
  const { token } = await params;

  const [invitation] = await db()
    .select({
      id: schema.invitations.id,
      email: schema.invitations.email,
      role: schema.invitations.role,
      organizationId: schema.invitations.organizationId,
      organizationName: schema.organizations.name,
    })
    .from(schema.invitations)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.invitations.organizationId),
    )
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
    return (
      <>
        <PageHeader title="Invitation" />
        <PageBody>
          <Card tone="panel">
            <Empty
              icon="mail-x"
              title="This invitation is not valid"
              body="It may have been used already, revoked, or expired — invitations last seven days. Ask whoever invited you to send a new one."
            />
          </Card>
        </PageBody>
      </>
    );
  }

  // Bound to the address it was issued to. Signed in as someone else means the
  // link was forwarded, and accepting would put the wrong person in the
  // workspace.
  const addressMatches =
    session.user.email.toLowerCase() === invitation.email.toLowerCase();

  const alreadyMember = await isMember(invitation.organizationId, session.user.id);

  return (
    <>
      <PageHeader title="Invitation" meta={invitation.organizationName} />
      <PageBody>
        <Card tone="panel" style={{ maxWidth: 560 }}>
          {alreadyMember ? (
            <Empty
              icon="check"
              title="You are already in this workspace"
              body={`Nothing to accept — you already have access to ${invitation.organizationName}.`}
            />
          ) : !addressMatches ? (
            <Empty
              icon="user-x"
              title="This invitation is for someone else"
              body={`It was issued to ${invitation.email}, and you are signed in as ${session.user.email}. Sign in as the invited address, or ask for an invitation to this one.`}
            />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-7)" }}>
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                <h2 style={{ fontSize: "var(--size-subtitle)" }}>
                  Join {invitation.organizationName}
                </h2>
                <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
                  You have been invited as a {ROLE_LABELS[invitation.role as MemberRole].toLowerCase()}.
                </span>
              </div>

              <p
                style={{
                  fontSize: "var(--size-label)",
                  color: "var(--text-body)",
                  lineHeight: "var(--lh-normal)",
                  padding: "var(--space-5) var(--space-6)",
                  borderRadius: "var(--radius-3)",
                  background: "var(--surface-inset)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {ROLE_DESCRIPTIONS[invitation.role as MemberRole]}
              </p>

              <AcceptInvite token={token} organization={invitation.organizationName} />
            </div>
          )}
        </Card>
      </PageBody>
    </>
  );
}

async function isMember(organizationId: string, userId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
