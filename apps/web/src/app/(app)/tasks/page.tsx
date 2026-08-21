import type { Metadata } from "next";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listAssignees, listTasks } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { TaskBoard } from "./TaskBoard";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

/**
 * The shared board — one queue for people and agents (FEATURES.md §19).
 *
 * There is deliberately no "my tasks" and "AI tasks" split. The premise of
 * the whole feature is that this is one team's work: a human assigns
 * something to an agent by picking it from the same dropdown they would pick
 * a colleague from, and an agent hands something back by creating a row here
 * with a stated reason. Two boards would make the handoff a transfer between
 * systems rather than a normal act of delegation.
 */
export default async function TasksPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const [tasks, assignees] = await Promise.all([listTasks(orgId), listAssignees(orgId)]);

  const handoffs = tasks.filter((t) => t.handoffReason && t.status !== "done").length;

  return (
    <>
      <PageHeader
        title="Tasks"
        meta={
          tasks.length
            ? `${tasks.length} open${handoffs ? ` · ${handoffs} handed over by an agent` : ""}`
            : session.workspace.organizationName
        }
      />
      <PageBody>
        <TaskBoard
          tasks={tasks.map((t) => ({
            id: t.id,
            title: t.title,
            body: t.body,
            status: t.status,
            priority: t.priority,
            assigneeType: t.assigneeType,
            assigneeName: t.assigneeName,
            assigneeAvatar: t.assigneeAvatar,
            creatorType: t.creatorType,
            creatorAgentName: t.creatorAgentName,
            handoffReason: t.handoffReason,
            dueAt: t.dueAt?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
          }))}
          people={assignees.people.map((p) => ({
            id: p.id,
            label: p.name ?? p.email,
          }))}
          agents={assignees.agents.map((a) => ({
            id: a.id,
            label: `${a.avatar}  ${a.name} — ${a.roleTitle}`,
          }))}
          projects={session.projects.map((p) => ({ id: p.id, slug: p.slug }))}
          canManage={can.manageTasks(session.workspace.role)}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
