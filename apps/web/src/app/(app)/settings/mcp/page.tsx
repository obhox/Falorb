import type { Metadata } from "next";
import { Badge, Card } from "@falorb/ui";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listKeys } from "@/server/keys";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { CopyField } from "@/components/CopyField";
import { KeysPanel, type KeyView } from "./KeysPanel";

export const metadata: Metadata = { title: "MCP & API keys" };
export const dynamic = "force-dynamic";

/**
 * Connecting an assistant.
 *
 * The MCP server exposes this workspace's analytics as tools an assistant can
 * call, authenticated with an API key. Both halves live here because they are
 * useless apart: the key is meaningless without knowing where to point it, and
 * the endpoint is unreachable without a key.
 *
 * Tool inventory is described rather than enumerated from the server — the
 * dashboard cannot introspect a separate process, and a hardcoded list that
 * drifts would be worse than an honest summary.
 */
export default async function McpSettingsPage() {
  const session = await requireSession();
  const keys = await listKeys(session.workspace.organizationId);
  const now = Date.now();

  const mcpUrl = process.env.FALORB_MCP_URL ?? "http://localhost:3002/mcp";
  const stdioCommand = process.env.FALORB_MCP_COMMAND ?? "pnpm --filter @falorb/mcp start";

  const projectsById = new Map(session.projects.map((p) => [p.id, p.name]));

  const views: KeyView[] = keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    project: key.projectId ? (projectsById.get(key.projectId) ?? `#${key.projectId}`) : null,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  }));

  const live = views.filter(
    (key) => !key.revokedAt && (!key.expiresAt || new Date(key.expiresAt).getTime() > now),
  ).length;

  return (
    <>
      <PageHeader
        title="MCP & API keys"
        meta={`${live} active ${live === 1 ? "key" : "keys"}`}
      />

      <PageBody>
        <Card
          title="Connect an assistant"
          subtitle="Falorb speaks the Model Context Protocol, so an assistant can query this workspace directly"
        >
          <div style={{ display: "grid", gap: "var(--space-7)" }}>
            <CopyField label="Remote MCP endpoint" value={mcpUrl} />

            <p
              style={{
                fontSize: "var(--size-body-sm)",
                color: "var(--text-body)",
                lineHeight: "var(--lh-normal)",
                maxWidth: "66ch",
              }}
            >
              Two transports are supported. <strong>Remote</strong> — the endpoint above, with an
              API key as a bearer token; use this for hosted clients and for Claude Code.{" "}
              <strong>Local</strong> — the assistant launches the server itself over stdio; use
              this for Claude Desktop on the same machine. Create a key below and the exact
              configuration for both is shown with it.
            </p>

            <div style={{ display: "grid", gap: 6 }}>
              <span
                style={{
                  fontSize: "var(--size-micro)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--ls-label)",
                  color: "var(--text-muted)",
                  fontWeight: "var(--wt-medium)",
                }}
              >
                What an assistant can do with a read key
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[
                  "list properties",
                  "overview & stats",
                  "trends & breakdowns",
                  "funnels & drop-off",
                  "retention",
                  "user flows",
                  "people & profiles",
                  "cross-property people",
                  "live visitors",
                  "install snippet",
                ].map((capability) => (
                  <Badge key={capability} tone="neutral">
                    {capability}
                  </Badge>
                ))}
              </div>
              <span
                style={{
                  fontSize: "var(--size-micro)",
                  color: "var(--text-muted)",
                  lineHeight: "var(--lh-normal)",
                }}
              >
                Creating an alert additionally needs the write scope. Destructive tools are
                excluded from MCP entirely — an assistant cannot delete a property or erase a
                person, whatever it is asked.
              </span>
            </div>
          </div>
        </Card>

        <KeysPanel
          keys={views}
          projects={session.projects.map((p) => ({ slug: p.slug, name: p.name }))}
          canManage={can.manageTeam(session.workspace.role)}
          mcpUrl={mcpUrl}
          stdioCommand={stdioCommand}
          now={now}
        />

        <Card title="Keys and safety" subtitle="What a key can reach, and what it cannot">
          <ul
            style={{
              margin: 0,
              paddingLeft: "1.1em",
              display: "grid",
              gap: 8,
              fontSize: "var(--size-label)",
              color: "var(--text-body)",
              lineHeight: "var(--lh-normal)",
              maxWidth: "66ch",
            }}
          >
            <li>
              A key is scoped to this workspace. It cannot read another organization&apos;s data,
              and restricting it to one property narrows it further.
            </li>
            <li>
              Only a SHA-256 hash is stored. A leaked database yields no usable keys, and the
              plaintext cannot be recovered — lost keys are revoked and reissued.
            </li>
            <li>
              Revoking takes effect on the next request. The row survives as the record of what
              existed and when it was last used.
            </li>
            <li>
              The same key authenticates the HTTP API, so anything an assistant can read, a script
              can too.
            </li>
          </ul>
        </Card>
      </PageBody>
    </>
  );
}
