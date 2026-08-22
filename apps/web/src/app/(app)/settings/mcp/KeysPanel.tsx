"use client";

import { useState } from "react";
// From core, not db: this is a client component, and `@falorb/db` pulls
// `postgres` into the browser bundle. The role model is pure logic and lives
// on the client-safe side of that line for exactly this reason.
import { ROLE_DESCRIPTIONS, ROLE_LABELS, rankOf, type MemberRole } from "@falorb/core";
import { Badge, Button, Card, Checkbox, Dialog, Icon, IconButton, Input, Select } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { Empty } from "@/components/Empty";
import { createApiKey, revokeApiKey } from "@/server/actions/keys";
import { useAction } from "@/lib/use-action";
import { relative, shortDate } from "@/lib/format";

export interface KeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  /** The membership role the key acts with — what it may do, as opposed to
   * `scopes`, which is whether it may write at all. */
  role: string;
  project: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * API keys, and the connection snippets that use them.
 *
 * The key is shown once, in a dialog that stays open until dismissed, with the
 * ready-made client config beside it. Handing back a bare secret and leaving
 * someone to work out where it goes is how keys end up pasted into the wrong
 * file.
 */
export function KeysPanel({
  keys,
  projects,
  canManage,
  viewerRole,
  mcpUrl,
  stdioCommand,
  now,
}: {
  keys: KeyView[];
  projects: { slug: string; name: string }[];
  canManage: boolean;
  /** The viewer's own role. A key is never issued above it, so the picker
   * below only offers what this person can actually delegate. */
  viewerRole: string;
  mcpUrl: string;
  stdioCommand: string;
  now: number;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();

  const [name, setName] = useState("");
  // Least privilege by default: the overwhelmingly common key is an assistant
  // reading reports, which needs nothing more than viewer.
  const [role, setRole] = useState<MemberRole>("viewer");
  const [write, setWrite] = useState(false);
  const [scope, setScope] = useState("");
  const [expiry, setExpiry] = useState("");
  const [issued, setIssued] = useState<string | null>(null);

  async function submit() {
    const data = new FormData();
    data.set("name", name);
    if (write) data.set("write", "on");
    data.set("role", role);
    data.set("project", scope);
    data.set("expires_in_days", expiry);

    const result = await run(() => createApiKey(data));
    if (!result?.ok) return;

    setIssued(result.key ?? null);
    setName("");
  }

  async function revoke(id: string) {
    await run(() => revokeApiKey(id));
  }

  const scopeLabels = ["All properties", ...projects.map((p) => p.name)];

  /**
   * Only roles at or below the issuer's own. The server refuses anything higher
   * regardless — `capForRole` is the actual guard — but offering a choice that
   * will always be rejected is a form the reader can only lose at.
   */
  const grantableRoles = (["viewer", "member", "admin", "owner"] as MemberRole[]).filter(
    (r) => rankOf(r) <= rankOf(viewerRole),
  );
  const roleLabels = grantableRoles.map((r) => ROLE_LABELS[r]);

  return (
    <>
      <Card
        title="API keys"
        subtitle="What an assistant authenticates with. Shown once, stored only as a hash."
        action={
          canManage ? (
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Icon name="key" size={13} />}
              onClick={() => {
                setIssued(null);
                setOpen(true);
              }}
            >
              New key
            </Button>
          ) : undefined
        }
      >
        {keys.length === 0 ? (
          <Empty
            icon="key"
            title="No API keys"
            body={
              canManage
                ? "A key lets an assistant, a script or CI read this workspace over MCP or the HTTP API."
                : "An owner or admin can issue keys for this workspace."
            }
            action={
              canManage ? (
                <Button size="sm" onClick={() => setOpen(true)}>
                  Create the first key
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="falorb-scroll-x">
          <div style={{ display: "grid", gap: 1 }}>
            <div style={head}>
              <span>Name</span>
              <span>Key</span>
              <span>Scope</span>
              <span style={{ textAlign: "right" }}>Last used</span>
              {canManage && <span />}
            </div>

            {keys.map((key) => {
              const dead =
                Boolean(key.revokedAt) ||
                Boolean(key.expiresAt && new Date(key.expiresAt).getTime() < now);

              return (
                <div key={key.id} style={{ ...body, opacity: dead ? 0.45 : 1 }}>
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
                      {key.name}
                    </span>
                    <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                      {key.revokedAt
                        ? `revoked ${relative(key.revokedAt, now)}`
                        : key.expiresAt
                          ? `expires ${shortDate(key.expiresAt, now)}`
                          : `created ${shortDate(key.createdAt, now)}`}
                    </span>
                  </span>

                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--size-micro)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {key.prefix}…
                  </span>

                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Badge tone={key.scopes.includes("write") ? "warn" : "neutral"}>
                      {key.scopes.includes("write") ? "read + write" : "read"}
                    </Badge>
                    {/* Role, not just scope: two `read + write` keys can differ
                        enormously in what they may actually change. */}
                    <Badge tone={rankOf(key.role) >= rankOf("admin") ? "warn" : "neutral"}>
                      {ROLE_LABELS[key.role as MemberRole] ?? key.role}
                    </Badge>
                    {key.project && <Badge tone="neutral">{key.project}</Badge>}
                  </span>

                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--size-micro)",
                      color: "var(--text-muted)",
                      textAlign: "right",
                    }}
                  >
                    {key.lastUsedAt ? relative(key.lastUsedAt, now) : "never"}
                  </span>

                  {canManage && (
                    <span style={{ display: "flex", justifyContent: "flex-end" }}>
                      {!dead && (
                        <IconButton
                          size="sm"
                          label={`Revoke ${key.name}`}
                          icon={<Icon name="ban" size={13} />}
                          disabled={pending}
                          onClick={() => void revoke(key.id)}
                        />
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        )}

      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={issued ? "Key created" : "New API key"}
        subtitle={
          issued
            ? "Copy it now — it cannot be shown again"
            : "What the key may do, and how long it lives"
        }
        width={560}
        footer={
          issued ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={submit} disabled={pending || !name.trim()}>
                {pending ? "Creating" : "Create key"}
              </Button>
            </>
          )
        }
      >
        {issued ? (
          <div style={{ display: "grid", gap: "var(--space-7)" }}>
            <CopyField label="API key" value={issued} />

            <CopyField
              label="Remote MCP server (Claude Code, and any client accepting a URL)"
              value={`claude mcp add --transport http falorb ${mcpUrl} --header "Authorization: Bearer ${issued}"`}
            />

            <CopyField
              label="Local MCP server (claude_desktop_config.json)"
              value={JSON.stringify(
                {
                  mcpServers: {
                    falorb: {
                      command: stdioCommand.split(" ")[0],
                      args: stdioCommand.split(" ").slice(1),
                      env: { FALORB_API_KEY: issued },
                    },
                  },
                },
                null,
                2,
              )}
            />

            <p
              style={{
                fontSize: "var(--size-micro)",
                color: "var(--text-muted)",
                lineHeight: "var(--lh-normal)",
              }}
            >
              Only a SHA-256 hash of this key is stored, so nothing here or in the database can
              show it a second time. If it is lost, revoke it and issue another.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Input
              label="Name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="My assistant"
              hint="Where the key will live, so it can be recognised later."
            />

            <div style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: "var(--size-label)",
                  color: "var(--text-secondary)",
                  fontWeight: "var(--wt-medium)",
                }}
              >
                Property
              </span>
              <Select
                size="sm"
                value={scope ? (projects.find((p) => p.slug === scope)?.name ?? "All properties") : "All properties"}
                options={scopeLabels}
                onChange={(label: string) => {
                  const project = projects.find((p) => p.name === label);
                  setScope(project?.slug ?? "");
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                options={roleLabels}
                onChange={(label: string) => {
                  const next = grantableRoles.find((r) => ROLE_LABELS[r] === label);
                  if (next) setRole(next);
                }}
              />
              <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                {ROLE_DESCRIPTIONS[role]}
              </span>
            </div>

            <Checkbox
              checked={write}
              onChange={setWrite}
              label="Allow writes"
              description="Lets the holder change things at all. The role above decides which things; this decides whether it may change anything. Leave it off unless you know it is needed."
            />

            <Input
              label="Expires in"
              mono
              value={expiry}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpiry(e.target.value)}
              suffix="days"
              placeholder="never"
              hint="Blank means it never expires. A key you cannot remember issuing is one worth expiring."
            />

          </div>
        )}
      </Dialog>
    </>
  );
}

const columns = "minmax(0,1.2fr) 130px minmax(0,1fr) 100px 34px";

const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: columns,
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
  gridTemplateColumns: columns,
  gap: 12,
  minHeight: "var(--row-height)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};
