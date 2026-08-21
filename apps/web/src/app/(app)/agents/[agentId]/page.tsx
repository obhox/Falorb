import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TOOLKIT_DESCRIPTIONS, TOOLKIT_LABELS, TOOLKITS } from "@falorb/agents";
import { can, MEMBER_ROLES } from "@falorb/db";
import { requireSession } from "@/server/session";
import { getAgent, listMemories, listRuns } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { AgentDetail } from "./AgentDetail";

export const metadata: Metadata = { title: "Agent" };
export const dynamic = "force-dynamic";

/**
 * One agent: its brief, its powers, its shift history, and what it has
 * learned.
 *
 * Ordered the way a manager would actually review someone — what they did
 * first, then the settings that shaped it. Putting the configuration at the
 * top would make this a settings page for a thing, rather than a page about
 * a colleague.
 */
export default async function AgentPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const agent = await getAgent(orgId, agentId);
  if (!agent) notFound();

  const [runs, memories] = await Promise.all([listRuns(orgId, agentId), listMemories(agentId)]);

  return (
    <>
      <PageHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden>{agent.avatar}</span>
            {agent.name}
          </span>
        }
        meta={agent.roleTitle}
      />
      <PageBody>
        <AgentDetail
          agent={{
            id: agent.id,
            name: agent.name,
            roleTitle: agent.roleTitle,
            avatar: agent.avatar,
            instructions: agent.instructions,
            role: agent.role,
            autonomy: agent.autonomy,
            status: agent.status,
            toolkits: agent.toolkits,
            projectIds: agent.projectIds,
            scheduleMinutes: agent.scheduleMinutes,
            scheduleObjective: agent.scheduleObjective,
            maxStepsPerRun: agent.maxStepsPerRun,
            dailyRunLimit: agent.dailyRunLimit,
            unattended: agent.autoApproveTools.includes("*"),
            nextRunAt: agent.nextRunAt?.toISOString() ?? null,
            lastRunAt: agent.lastRunAt?.toISOString() ?? null,
          }}
          runs={runs.map((r) => ({
            id: r.id,
            trigger: r.trigger,
            objective: r.objective,
            status: r.status,
            summary: r.summary,
            error: r.error,
            stepCount: r.stepCount,
            costUsd: Number(r.costUsd),
            tokens: r.promptTokens + r.completionTokens,
            createdAt: r.createdAt.toISOString(),
            finishedAt: r.finishedAt?.toISOString() ?? null,
          }))}
          memories={memories.map((m) => ({
            key: m.key,
            scope: m.scope,
            content: m.content,
            importance: m.importance,
            updatedAt: m.updatedAt.toISOString(),
          }))}
          projects={session.projects.map((p) => ({ id: p.id, slug: p.slug }))}
          toolkits={TOOLKITS.map((t) => ({
            key: t,
            label: TOOLKIT_LABELS[t],
            description: TOOLKIT_DESCRIPTIONS[t],
          }))}
          roles={[...MEMBER_ROLES]}
          canManage={can.manageAgents(session.workspace.role)}
          canRun={can.runAgents(session.workspace.role)}
          viewerIsOwner={session.workspace.role === "owner"}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
