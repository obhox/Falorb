import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/session";
import { isBundAiConnected, listConversations, listEscalations, listLeads, listTickets } from "@/server/support";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { SupportTabsPanel } from "./SupportTabsPanel";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

/**
 * Bund AI support data, mirrored into Falorb. Escalations are resolvable
 * directly; conversations/leads/tickets are read-only for now.
 */
export default async function SupportPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const connected = await isBundAiConnected(orgId);
  if (!connected) {
    return (
      <>
        <PageHeader title="Support" meta={session.workspace.organizationName} />
        <PageBody>
          <Empty
            icon="life-buoy"
            title="Bund AI isn't connected"
            body="Connect it to see and resolve escalations, and view conversations, leads and tickets here."
            action={
              <Link href="/settings/integrations" style={{ textDecoration: "none" }}>
                Connect in Settings → Integrations
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const [escalations, conversations, leads, tickets] = await Promise.all([
    listEscalations(orgId),
    listConversations(orgId),
    listLeads(orgId),
    listTickets(orgId),
  ]);

  return (
    <>
      <PageHeader
        title="Support"
        meta={`${escalations.filter((e) => e.status !== "resolved").length} open escalations`}
      />
      <PageBody>
        <SupportTabsPanel
          escalations={escalations.map((e) => ({
            id: e.id,
            reason: e.reason,
            summary: e.summary,
            status: e.status,
            customerContact: e.customerContact,
            personId: e.personId,
            createdAt: e.bundAiCreatedAt?.toISOString() ?? null,
          }))}
          conversations={conversations.map((c) => ({
            id: c.id,
            personId: c.personId,
            channel: c.channel,
            status: c.status,
            externalUserRef: c.externalUserRef,
            lastActivityAt: c.lastActivityAt?.toISOString() ?? null,
          }))}
          leads={leads.map((l) => ({
            id: l.id,
            personId: l.personId,
            name: l.name,
            email: l.email,
            intent: l.intent,
            status: l.status,
            updatedAt: l.bundAiUpdatedAt?.toISOString() ?? null,
          }))}
          tickets={tickets.map((t) => ({
            id: t.id,
            personId: t.personId,
            subject: t.subject,
            category: t.category,
            priority: t.priority,
            status: t.status,
            updatedAt: t.bundAiUpdatedAt?.toISOString() ?? null,
          }))}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
