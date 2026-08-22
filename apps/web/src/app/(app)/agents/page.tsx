import type { Metadata } from "next";
import { AGENT_PRESETS, TOOLKIT_DESCRIPTIONS, TOOLKIT_LABELS, TOOLKITS } from "@falorb/agents";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { countPendingApprovals, listAgents } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { AgentRoster } from "./AgentRoster";

export const metadata: Metadata = { title: "Agents" };
export const dynamic = "force-dynamic";

/**
 * The roster — who works here (FEATURES.md §19).
 *
 * People and agents are colleagues on the same board, so this page's job is
 * to read like a team page rather than a settings screen: a name, a job
 * title, whether they are on shift, and what they last did. The controls
 * that matter — brief, permissions, autonomy — are one level down, on the
 * individual, which is where you would go to have that conversation with a
 * person too.
 */
export default async function AgentsPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const [agents, pendingApprovals] = await Promise.all([
    listAgents(orgId),
    countPendingApprovals(orgId),
  ]);

  const active = agents.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader
        title="Agents"
        meta={
          agents.length
            ? `${active} on shift · ${agents.length - active} paused`
            : session.workspace.organizationName
        }
      />
      <PageBody>
        <AgentRoster
          agents={agents.map((a) => ({
            id: a.id,
            name: a.name,
            roleTitle: a.roleTitle,
            avatar: a.avatar,
            role: a.role,
            autonomy: a.autonomy,
            status: a.status,
            toolkits: a.toolkits,
            scheduleMinutes: a.scheduleMinutes,
            nextRunAt: a.nextRunAt?.toISOString() ?? null,
            lastRunAt: a.lastRunAt?.toISOString() ?? null,
            lastSummary: a.lastSummary,
            lastRunStatus: a.lastRunStatus,
            recentRuns: a.recentRuns,
            openTasks: a.openTasks,
            pendingApprovals: a.pendingApprovals,
            unattended: a.autoApproveTools.includes("*"),
          }))}
          presets={AGENT_PRESETS.map((p) => ({
            key: p.key,
            name: p.name,
            roleTitle: p.roleTitle,
            avatar: p.avatar,
            summary: p.summary,
            toolkits: p.toolkits,
            scheduleMinutes: p.scheduleMinutes,
          }))}
          toolkits={TOOLKITS.map((t) => ({
            key: t,
            label: TOOLKIT_LABELS[t],
            description: TOOLKIT_DESCRIPTIONS[t],
          }))}
          projects={session.projects.map((p) => ({ id: p.id, slug: p.slug }))}
          canManage={can.manageAgents(session.workspace.role)}
          pendingApprovals={pendingApprovals}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
