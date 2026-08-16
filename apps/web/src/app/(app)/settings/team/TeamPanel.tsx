"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  IconButton,
  Input,
  Select,
} from "@falorb/ui";
import {
  ASSIGNABLE_ROLES,
  INVITABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type MemberRole,
} from "@falorb/db";
import { CopyField } from "@/components/CopyField";
import { Empty } from "@/components/Empty";
import {
  changeMemberRole,
  inviteMember,
  removeMember,
  revokeInvitation,
} from "@/server/actions/team";
import { relative, shortDate } from "@/lib/format";

export interface TeamMemberView {
  userId: string;
  name: string | null;
  email: string;
  role: MemberRole;
  joinedAt: string;
  isYou: boolean;
}

export interface InvitationView {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  invitedByEmail: string | null;
}

/**
 * The team panel.
 *
 * Controls the viewer cannot use are not rendered at all rather than rendered
 * disabled — a disabled row of buttons invites people to work out how to enable
 * them. The server refuses independently, so this is presentation only.
 */
export function TeamPanel({
  members,
  invitations,
  canManage,
  canAssign,
  ownerCount,
  now,
}: {
  members: TeamMemberView[];
  invitations: InvitationView[];
  canManage: boolean;
  canAssign: boolean;
  ownerCount: number;
  now: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [issuedLink, setIssuedLink] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function submitInvite() {
    setError(null);
    const data = new FormData();
    data.set("email", email);
    data.set("role", role);

    const result = await inviteMember(data);
    if (!result.ok) {
      setError(result.message ?? "That invitation could not be sent.");
      return;
    }

    setIssuedLink(result.url ?? null);
    setEmail("");
    refresh();
  }

  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    setNotice(null);
    const result = await action();
    if (!result.ok) setError(result.message ?? "That did not work.");
    else if (result.message) setNotice(result.message);
    refresh();
  }

  return (
    <>
      <Card
        title="Members"
        subtitle={`${members.length} ${members.length === 1 ? "person" : "people"} in this workspace`}
        action={
          canManage ? (
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Icon name="user-plus" size={13} />}
              onClick={() => {
                setIssuedLink(null);
                setOpen(true);
              }}
            >
              Invite
            </Button>
          ) : undefined
        }
      >
        <div style={{ display: "grid", gap: 1 }}>
          <div style={{ ...head, gridTemplateColumns: columns(canManage) }}>
            <span>Person</span>
            <span>Role</span>
            <span style={{ textAlign: "right" }}>Joined</span>
            {canManage && <span />}
          </div>

          {members.map((member) => {
            // The last owner cannot be demoted or removed, or the workspace
            // becomes unadministrable.
            const isLastOwner = member.role === "owner" && ownerCount === 1;

            return (
              <div
                key={member.userId}
                style={{ ...body, gridTemplateColumns: columns(canManage) }}
              >
                <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: "var(--size-body-sm)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {member.name?.trim() || member.email}
                    {member.isYou && <Badge tone="neutral">you</Badge>}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--size-micro)",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {member.email}
                  </span>
                </span>

                {canAssign && !isLastOwner ? (
                  <Select
                    size="sm"
                    value={ROLE_LABELS[member.role]}
                    options={ASSIGNABLE_ROLES.map((r) => ROLE_LABELS[r])}
                    onChange={(label: string) => {
                      const next = ASSIGNABLE_ROLES.find((r) => ROLE_LABELS[r] === label);
                      if (next && next !== member.role) {
                        void run(() => changeMemberRole(member.userId, next));
                      }
                    }}
                  />
                ) : (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                      {ROLE_LABELS[member.role]}
                    </Badge>
                    {isLastOwner && (
                      <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                        only owner
                      </span>
                    )}
                  </span>
                )}

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                    textAlign: "right",
                  }}
                >
                  {shortDate(member.joinedAt, now)}
                </span>

                {canManage && (
                  <span style={{ display: "flex", justifyContent: "flex-end" }}>
                    {!isLastOwner && (
                      <IconButton
                        size="sm"
                        label={`Remove ${member.email}`}
                        icon={<Icon name="user-minus" size={13} />}
                        disabled={pending}
                        onClick={() => void run(() => removeMember(member.userId))}
                      />
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Pending invitations"
        subtitle="Unaccepted invitations expire after seven days"
      >
        {invitations.length === 0 ? (
          <Empty
            dense
            icon="mail"
            title="No invitations outstanding"
            body={
              canManage
                ? "Invite someone and their link appears here until they accept it."
                : "An owner or admin can invite people to this workspace."
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 1 }}>
            <div style={{ ...head, gridTemplateColumns: columns(canManage) }}>
              <span>Email</span>
              <span>Role</span>
              <span style={{ textAlign: "right" }}>Expires</span>
              {canManage && <span />}
            </div>

            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                style={{ ...body, gridTemplateColumns: columns(canManage) }}
              >
                <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: "var(--size-body-sm)",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {invitation.email}
                  </span>
                  {invitation.invitedByEmail && (
                    <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                      invited by {invitation.invitedByEmail}
                    </span>
                  )}
                </span>

                <Badge tone="neutral">{ROLE_LABELS[invitation.role]}</Badge>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                    textAlign: "right",
                  }}
                >
                  {relative(invitation.expiresAt, now)}
                </span>

                {canManage && (
                  <span style={{ display: "flex", justifyContent: "flex-end" }}>
                    <IconButton
                      size="sm"
                      label={`Revoke invitation for ${invitation.email}`}
                      icon={<Icon name="x" size={13} />}
                      disabled={pending}
                      onClick={() => void run(() => revokeInvitation(invitation.id))}
                    />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {(error || notice) && (
        <span
          role="status"
          style={{
            fontSize: "var(--size-label)",
            color: error ? "var(--signal-down)" : "var(--signal-up)",
          }}
        >
          {error ?? notice}
        </span>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Invite someone"
        subtitle="They join this workspace and see every property in it"
        width={480}
        footer={
          issuedLink ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={submitInvite} disabled={pending || !email.trim()}>
                Send invitation
              </Button>
            </>
          )
        }
      >
        {issuedLink ? (
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <CopyField label="Invitation link" value={issuedLink} />
            <p
              style={{
                fontSize: "var(--size-micro)",
                color: "var(--text-muted)",
                lineHeight: "var(--lh-normal)",
              }}
            >
              Shown once — only a hash of it is stored. If a mailer is configured the invitation
              was also emailed; if not, this link is the only copy. It expires in seven days and
              only works for the address it was issued to.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              placeholder="colleague@example.com"
            />

            <div style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: "var(--size-label)",
                  color: "var(--text-secondary)",
                  fontWeight: "var(--wt-medium)",
                }}
              >
                Role
              </span>
              <Select
                size="sm"
                value={ROLE_LABELS[role]}
                options={INVITABLE_ROLES.map((r) => ROLE_LABELS[r])}
                onChange={(label: string) => {
                  const next = INVITABLE_ROLES.find((r) => ROLE_LABELS[r] === label);
                  if (next) setRole(next);
                }}
              />
              <span
                style={{
                  fontSize: "var(--size-micro)",
                  color: "var(--text-muted)",
                  lineHeight: "var(--lh-normal)",
                }}
              >
                {ROLE_DESCRIPTIONS[role]}
              </span>
            </div>

            {error && (
              <span style={{ fontSize: "var(--size-label)", color: "var(--signal-down)" }}>
                {error}
              </span>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

function columns(canManage: boolean): string {
  return canManage ? "minmax(0,1.6fr) 160px 100px 44px" : "minmax(0,1.6fr) 160px 100px";
}

const head: React.CSSProperties = {
  display: "grid",
  gap: 12,
  height: 30,
  alignItems: "center",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--size-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-label)",
  color: "var(--text-muted)",
  fontWeight: "var(--wt-medium)",
};

const body: React.CSSProperties = {
  display: "grid",
  gap: 12,
  minHeight: "var(--row-height)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};
