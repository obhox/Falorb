import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Badge, Button, Card, Icon } from "@falorb/ui";
import { can, ROLE_LABELS, type MemberRole } from "@falorb/db";
import { db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import { getDomainStatuses } from "@/server/connection";
import { getOrgShare } from "@/server/sharing";
import { getIntegration } from "@/server/integrations";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { CopyField } from "@/components/CopyField";
import { DomainTestChips } from "@/components/DomainTest";
import { Empty } from "@/components/Empty";
import { num, shortDate } from "@/lib/format";
import { DigestToggle } from "./DigestToggle";
import { BenchmarkShareControl } from "./BenchmarkShareControl";
import { ClayConnectionPanel } from "./ClayConnectionPanel";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/**
 * Instance settings: the workspace, its properties, and where the pieces run.
 *
 * Per-property configuration lives on each property's own settings tab. This
 * page is the workspace level — what exists, and how the parts are wired.
 */
export default async function InstanceSettingsPage() {
  const session = await requireSession();
  const now = Date.now();

  // One query for every property's domains, so the list can say which of them
  // are reporting — and offer a test for each — without a round-trip per row.
  const domainStatuses = await getDomainStatuses(
    session.projects.map((p) => ({ id: p.id, domains: p.domains })),
  );

  const ingest = process.env.FALORB_INGEST_URL ?? "http://localhost:3001";
  const app = process.env.FALORB_APP_URL ?? "http://localhost:3000";
  const api = process.env.FALORB_API_URL ?? "http://localhost:3003";
  const referral = process.env.FALORB_REFERRAL_URL ?? app;

  const [[org], orgShare, clay] = await Promise.all([
    db()
      .select({ weeklyDigestEnabled: schema.organizations.weeklyDigestEnabled })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, session.workspace.organizationId))
      .limit(1),
    getOrgShare(session.workspace.organizationId),
    getIntegration(session.workspace.organizationId, "clay"),
  ]);
  const benchmarkUrl = orgShare?.publicToken
    ? `${app.replace(/\/$/, "")}/benchmark/${orgShare.publicToken}`
    : null;

  return (
    <>
      <PageHeader
        title="Settings"
        meta={session.workspace.organizationName}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link href="/settings/team" style={{ textDecoration: "none" }}>
              <Button size="sm" iconLeft={<Icon name="users" size={13} />}>
                Team
              </Button>
            </Link>
            <Link href="/settings/mcp" style={{ textDecoration: "none" }}>
              <Button size="sm" iconLeft={<Icon name="plug" size={13} />}>
                MCP & keys
              </Button>
            </Link>
            {can.manageProject(session.workspace.role) && (
              <Link href="/settings/new">
                <Button size="sm" variant="primary" iconLeft={<Icon name="plus" size={13} />}>
                  Add property
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <PageBody>
        <Card
          title="Properties"
          subtitle={
            session.projects.length === 0
              ? "0 tracked"
              : `${session.projects.length} tracked · press a domain to test its connection`
          }
        >
          {session.projects.length === 0 ? (
            <Empty
              dense
              icon="globe"
              title="No properties yet"
              body="A property is one site or app you collect events from."
              action={
                <Link href="/settings/new">
                  <Button size="sm">Add property</Button>
                </Link>
              }
            />
          ) : (
            <div className="falorb-scroll-x">
            <div style={{ display: "grid", gap: 1 }}>
              <div style={head}>
                <span>Property</span>
                <span>Domains</span>
                <span style={{ textAlign: "right" }}>Retention</span>
                <span style={{ textAlign: "right" }}>Created</span>
                <span />
              </div>

              {session.projects.map((project) => (
                <div key={project.id} style={{ ...body, position: "relative" }}>
                  {/* The row is still a link — opening three properties in
                      three tabs is what someone with ten sites does — but the
                      link is now an overlay rather than the row's container.
                      A <button> inside an <a> is invalid HTML, and the domain
                      tests below are buttons. */}
                  <Link
                    href={`/p/${project.slug}/settings`}
                    data-plain
                    aria-label={`${project.name} settings`}
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 1,
                      textDecoration: "none",
                    }}
                  />
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
                      {project.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--size-micro)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {project.slug}
                    </span>
                  </span>

                  {/* Above the overlay link, because these are buttons and a
                      test is not a navigation. */}
                  <span style={{ position: "relative", zIndex: 2, minWidth: 0 }}>
                    <DomainTestChips
                      slug={project.slug}
                      domains={domainStatuses.get(project.id) ?? []}
                    />
                  </span>

                  <span style={figure}>{num(project.retentionDays)}d</span>
                  <span style={{ ...figure, color: "var(--text-muted)" }}>
                    {shortDate(project.createdAt, now)}
                  </span>

                  <span style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                    {project.cookieless === 1 && <Badge tone="accent">cookieless</Badge>}
                    {project.identityScope === "org" && <Badge tone="neutral">portfolio</Badge>}
                  </span>
                </div>
              ))}
            </div>
            </div>
          )}
        </Card>

        <Card title="Endpoints" subtitle="Where each part of this instance is reachable">
          <div style={{ display: "grid", gap: "var(--space-7)" }}>
            <CopyField label="Collector" value={ingest} />
            <CopyField label="Dashboard" value={app} />
            <CopyField label="Referral links" value={referral} />
            <CopyField label="API" value={api} />
            <p
              style={{
                fontSize: "var(--size-micro)",
                color: "var(--text-muted)",
                maxWidth: "66ch",
                lineHeight: "var(--lh-normal)",
              }}
            >
              The API serves programs — scripts, CI, and the MCP server an assistant connects to.
              It authenticates with bearer keys rather than this session. Issue one on the{" "}
              <Link href="/settings/mcp">MCP &amp; keys page</Link>.
            </p>
          </div>
        </Card>

        <Card title="Workspace">
          <div style={{ display: "grid", gap: "var(--space-6)", maxWidth: "66ch" }}>
            <Row label="Organization" value={session.workspace.organizationName} />
            <Row
              label="Your role"
              value={ROLE_LABELS[session.workspace.role as MemberRole] ?? session.workspace.role}
            />
            <Row label="Signed in as" value={session.user.email} />
            <p
              style={{
                fontSize: "var(--size-micro)",
                color: "var(--text-muted)",
                lineHeight: "var(--lh-normal)",
              }}
            >
              Roles apply to the whole workspace, not per property. Manage who is in it on the{" "}
              <Link href="/settings/team">team page</Link>.
            </p>
          </div>
        </Card>

        <DigestToggle
          weeklyDigestEnabled={org?.weeklyDigestEnabled ?? true}
          canEdit={can.manageProject(session.workspace.role)}
        />

        {can.share(session.workspace.role) && <BenchmarkShareControl initialUrl={benchmarkUrl} />}

        <ClayConnectionPanel
          initial={
            clay
              ? {
                  status: clay.status,
                  credentialPreview: clay.credentialPreview,
                  lastSyncAt: clay.lastSyncAt?.toISOString() ?? null,
                  lastSyncError: clay.lastSyncError,
                }
              : null
          }
          canEdit={can.manageProject(session.workspace.role)}
        />
      </PageBody>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span
        style={{
          fontSize: "var(--size-micro)",
          textTransform: "uppercase",
          letterSpacing: "var(--ls-label)",
          color: "var(--text-muted)",
          fontWeight: "var(--wt-medium)",
          minWidth: 120,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>{value}</span>
    </div>
  );
}

const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.3fr) 90px 100px 170px",
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
  gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.3fr) 90px 100px 170px",
  gap: 12,
  minHeight: "var(--row-height)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-micro)",
  color: "var(--text-primary)",
  textAlign: "right",
};
