import { eq } from "drizzle-orm";
import { Card } from "@falorb/ui";
import { can, db, schema } from "@falorb/db";
import { requireProject } from "@/server/session";
import { getShare } from "@/server/sharing";
import { listProjectConnections } from "@/server/integrations";
import {
  getCollectorHealth,
  getConnectionStatus,
  getDomainStatuses,
} from "@/server/connection";
import { PageBody } from "@/components/shell/PageHeader";
import { CopyField } from "@/components/CopyField";
import { SettingsForm } from "./SettingsForm";
import { ShareControl } from "./ShareControl";
import { BadgeEmbedControl } from "./BadgeEmbedControl";
import { ConnectionPanel } from "./ConnectionPanel";
import { ProjectCreatedTracker } from "./ProjectCreatedTracker";
import { ProspectKeywordsCard } from "./ProspectKeywordsCard";
import { IntegrationsPanel } from "./IntegrationsPanel";

export const dynamic = "force-dynamic";

/**
 * Property settings: the snippet first, then the fields.
 *
 * The snippet is at the top because it is the only thing on this page a new
 * user needs, and it is the reason they navigated here.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { session, project } = await requireProject((await params).project);

  const [share, connection, collector, domainStatuses, keywords, integrationConnections] = await Promise.all([
    getShare(session.workspace.organizationId, project.id),
    getConnectionStatus(project.id),
    getCollectorHealth(),
    getDomainStatuses([{ id: project.id, domains: project.domains }]),
    db()
      .select({
        id: schema.prospectKeywords.id,
        keyword: schema.prospectKeywords.keyword,
        active: schema.prospectKeywords.active,
      })
      .from(schema.prospectKeywords)
      .where(eq(schema.prospectKeywords.projectId, project.id))
      .orderBy(schema.prospectKeywords.keyword),
    listProjectConnections(session.workspace.organizationId, project.id),
  ]);
  const origin = process.env.FALORB_APP_URL ?? "http://localhost:3000";

  const ingest = process.env.FALORB_INGEST_URL ?? "http://localhost:3001";
  const snippet = `<script defer src="${ingest}/t.js" data-project="${project.publicKey}"></script>`;

  return (
    <PageBody>
      <ProjectCreatedTracker />
      <ConnectionPanel
        slug={project.slug}
        initial={{
          state: connection.state,
          lastEventAt: connection.lastEventAt,
          events24h: connection.events24h,
          eventsTotal: connection.eventsTotal,
          collector,
          // Every authorised domain is testable on its own. Rolling the test up
          // to the property would let a pageview from the marketing site vouch
          // for an app that has no snippet.
          domains: domainStatuses.get(project.id) ?? [],
        }}
      />

      <Card
        title="Install"
        subtitle="One tag in <head>. 1.94 KB gzipped, no cookies in cookieless mode."
      >
        <div style={{ display: "grid", gap: "var(--space-7)" }}>
          <CopyField value={snippet} />
          <CopyField label="Public key" value={project.publicKey} />
          <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", maxWidth: "66ch" }}>
            The public key ships in your page source by design — it identifies the property, it does
            not authorise anything. Events are only accepted from the domains listed below, so a
            copied key cannot be used to write into this property from elsewhere.
          </p>
        </div>
      </Card>

      {can.share(session.workspace.role) && (
      <>
      <ShareControl
        slug={project.slug}
        initialUrl={
          share?.publicToken ? `${origin.replace(/\/$/, "")}/share/${share.publicToken}` : null
        }
      />
      <BadgeEmbedControl
        slug={project.slug}
        initialToken={share?.publicToken ?? null}
        origin={origin.replace(/\/$/, "")}
      />
      </>
      )}

      <ProspectKeywordsCard
        slug={project.slug}
        keywords={keywords}
        canEdit={can.writeAnalysis(session.workspace.role)}
      />

      <IntegrationsPanel
        slug={project.slug}
        connections={integrationConnections}
        canManage={can.manageIntegrations(session.workspace.role)}
        now={Date.now()}
      />

      <SettingsForm
        project={{
          slug: project.slug,
          name: project.name,
          domains: project.domains,
          timezone: project.timezone,
          identityScope: project.identityScope,
          consentMode: project.consentMode,
          cookieless: project.cookieless === 1,
          retentionDays: project.retentionDays,
        }}
        canEdit={can.manageProject(session.workspace.role)}
      />
    </PageBody>
  );
}
