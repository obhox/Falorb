import type { Metadata } from "next";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listConnections } from "@/server/integrations";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { IntegrationsPanel } from "./IntegrationsPanel";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

/**
 * Connect Linki (sales/outreach) and Bund AI (support) — each keeps running
 * as its own service; this stores the credential Falorb uses to call it and
 * mirror its data. See FEATURES.md §13 for what "connected" actually enables.
 */
export default async function IntegrationsPage() {
  const session = await requireSession();
  const connections = await listConnections(session.workspace.organizationId);

  return (
    <>
      <PageHeader title="Integrations" meta={session.workspace.organizationName} />
      <PageBody>
        <IntegrationsPanel
          connections={connections}
          canManage={can.manageIntegrations(session.workspace.role)}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
