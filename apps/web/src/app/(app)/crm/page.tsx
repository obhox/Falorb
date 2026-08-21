import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { isLinkiConnected } from "@/server/actions/crm";
import {
  ensureDealStages,
  listCrmProfiles,
  listDeals,
  listLists,
  listRuns,
  listSentMessages,
  listSignalRules,
  listSuppressions,
  listUnmatchedContacts,
  listWorkflows,
} from "@/server/crm";
import { getTeam } from "@/server/team";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { CrmTabsPanel } from "./CrmTabsPanel";

export const metadata: Metadata = { title: "CRM" };
export const dynamic = "force-dynamic";

/**
 * Falorb's own CRM — Contacts and Pipeline are Falorb-owned data and render
 * regardless of whether Linki is connected. Workflows/Lists/Signal rules and
 * the "From Linki" backlog stay Linki-mirror views, gated behind a live
 * connection.
 */
export default async function CrmPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const connected = await isLinkiConnected(orgId);

  const [profiles, deals, stages, team, unmatchedContacts, workflows, lists, signalRules, runs, sentMessages, suppressions] =
    await Promise.all([
      listCrmProfiles(orgId),
      listDeals(orgId),
      ensureDealStages(orgId),
      getTeam(orgId),
      connected ? listUnmatchedContacts(orgId) : Promise.resolve([]),
      connected ? listWorkflows(orgId) : Promise.resolve([]),
      connected ? listLists(orgId) : Promise.resolve([]),
      connected ? listSignalRules(orgId) : Promise.resolve([]),
      connected ? listRuns(orgId) : Promise.resolve([]),
      connected ? listSentMessages(orgId) : Promise.resolve([]),
      connected ? listSuppressions(orgId) : Promise.resolve([]),
    ]);

  return (
    <>
      <PageHeader title="CRM" meta={`${profiles.length} contacts · ${deals.length} deals`} />
      <PageBody>
        <CrmTabsPanel
          connected={connected}
          profiles={profiles}
          deals={deals}
          stages={stages.map((s) => ({ id: s.id, name: s.name, position: s.position, isWon: s.isWon, isLost: s.isLost }))}
          owners={team.members.map((m) => ({ id: m.userId, name: m.name ?? m.email }))}
          unmatchedContacts={unmatchedContacts.map((c) => ({
            id: c.id,
            fullName: c.fullName,
            email: c.email,
            company: c.company,
            linkedinUrl: c.linkedinUrl,
            syncedAt: c.syncedAt.toISOString(),
          }))}
          workflows={workflows.map((w) => ({ id: w.id, linkiId: w.linkiId, name: w.name, description: w.description }))}
          lists={lists}
          signalRules={signalRules.map((r) => ({
            id: r.id,
            name: r.name,
            signalType: r.signalType,
            minScore: r.minScore,
            workflowLinkiId: r.workflowLinkiId,
            enabled: r.enabled,
            autoStart: r.autoStart,
          }))}
          runs={runs}
          sentMessages={sentMessages}
          suppressions={suppressions}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
