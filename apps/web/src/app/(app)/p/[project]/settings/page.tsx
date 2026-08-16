import { Card } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { getShare } from "@/server/sharing";
import { PageBody } from "@/components/shell/PageHeader";
import { CopyField } from "@/components/CopyField";
import { SettingsForm } from "./SettingsForm";
import { ShareControl } from "./ShareControl";

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

  const share = await getShare(session.workspace.organizationId, project.id);
  const origin = process.env.FALORB_APP_URL ?? "http://localhost:3000";

  const ingest = process.env.FALORB_INGEST_URL ?? "http://localhost:3001";
  const snippet = `<script defer src="${ingest}/t.js" data-project="${project.publicKey}"></script>`;

  return (
    <PageBody>
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

      <ShareControl
        slug={project.slug}
        initialUrl={
          share?.publicToken ? `${origin.replace(/\/$/, "")}/share/${share.publicToken}` : null
        }
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
      />
    </PageBody>
  );
}
