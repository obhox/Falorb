import type { Metadata } from "next";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listConnections } from "@/server/integrations";
import { listMcpServers } from "@/server/mcp-servers";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { McpServersPanel } from "./McpServersPanel";

export const metadata: Metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

/**
 * Connect the web-research provider and the AI gateway Falorb's AI features
 * run on, plus any remote MCP server an AI employee may call tools on. This
 * stores the credential Falorb uses; see FEATURES.md §13 for what
 * "connected" actually enables.
 */
export default async function IntegrationsPage() {
  const session = await requireSession();
  const [connections, mcpServers] = await Promise.all([
    listConnections(session.workspace.organizationId),
    listMcpServers(session.workspace.organizationId),
  ]);

  return (
    <>
      <PageHeader title="Integrations" meta={session.workspace.organizationName} />
      <PageBody>
        <IntegrationsPanel
          connections={connections}
          canManage={can.manageIntegrations(session.workspace.role)}
          now={Date.now()}
        />
        <McpServersPanel
          servers={mcpServers}
          canManage={can.manageIntegrations(session.workspace.role)}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
