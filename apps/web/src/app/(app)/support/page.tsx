import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { isBundAiConnected, listEscalations } from "@/server/support";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { EscalationsPanel, type EscalationView } from "./EscalationsPanel";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

/**
 * Bund AI support escalations, mirrored into Falorb and resolvable from here.
 * Read-only conversations/leads/tickets views are a natural follow-up; this
 * page starts with the one screen that has an action attached to it.
 */
export default async function SupportPage() {
  const session = await requireSession();
  const [connected, escalations] = await Promise.all([
    isBundAiConnected(session.workspace.organizationId),
    listEscalations(session.workspace.organizationId),
  ]);

  const views: EscalationView[] = escalations.map((e) => ({
    id: e.id,
    reason: e.reason,
    summary: e.summary,
    status: e.status,
    customerContact: e.customerContact,
    personId: e.personId,
    createdAt: e.bundAiCreatedAt?.toISOString() ?? null,
  }));

  return (
    <>
      <PageHeader
        title="Support"
        meta={`${views.filter((v) => v.status !== "resolved").length} open of ${views.length}`}
      />
      <PageBody>
        <EscalationsPanel escalations={views} connected={connected} now={Date.now()} />
      </PageBody>
    </>
  );
}
