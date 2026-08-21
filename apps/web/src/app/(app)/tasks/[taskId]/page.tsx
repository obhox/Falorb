import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card } from "@falorb/ui";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { getTask, listAssignees } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { dateTime } from "@/lib/format";
import { TaskEditCard } from "./TaskEditCard";
import { TaskThread } from "./TaskThread";

export const metadata: Metadata = { title: "Task" };
export const dynamic = "force-dynamic";

/**
 * One task, and the conversation on it.
 *
 * The thread is where a human and an agent actually talk: an agent reads the
 * whole thing when it picks the task up, so leaving a comment is how you
 * redirect one mid-flight without rewriting its brief.
 */
export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const found = await getTask(orgId, taskId);
  if (!found) notFound();

  const { task, comments } = found;
  const assignees = await listAssignees(orgId);

  return (
    <>
      <PageHeader title={task.title} meta={`opened ${dateTime(task.createdAt)}`} />
      <PageBody>
        <div style={{ display: "grid", gap: "var(--space-5)", maxWidth: 820 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Badge tone={task.status === "done" ? "up" : "neutral"}>
              {task.status.replace("_", " ")}
            </Badge>
            <Badge tone={task.priority === "urgent" ? "down" : "neutral"}>{task.priority}</Badge>
            {task.handoffReason && <Badge tone="warn">handed over by an agent</Badge>}
          </div>

          {task.handoffReason && (
            <Card title="Why this needs a person" tone="inset" padding={14}>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                {task.handoffReason}
              </p>
            </Card>
          )}

          {task.body && (
            <Card title="Context">
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {task.body}
              </p>
            </Card>
          )}

          {task.result && (
            <Card title="Result">
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {task.result}
              </p>
            </Card>
          )}

          {can.manageTasks(session.workspace.role) && (
            <TaskEditCard
              taskId={task.id}
              title={task.title}
              body={task.body}
              priority={task.priority}
              projectId={task.projectId}
              dueAt={task.dueAt?.toISOString() ?? null}
              projects={session.projects.map((p) => ({ id: p.id, slug: p.slug }))}
            />
          )}

          <TaskThread
            taskId={task.id}
            status={task.status}
            comments={comments.map((c) => ({
              id: c.id,
              authorType: c.authorType,
              author: c.agentName ?? c.userName ?? "Falorb",
              avatar: c.agentAvatar,
              body: c.body,
              createdAt: c.createdAt.toISOString(),
            }))}
            assignees={[
              ...assignees.agents.map((a) => ({
                value: `agent:${a.id}`,
                label: `${a.avatar}  ${a.name} — ${a.roleTitle}`,
              })),
              ...assignees.people.map((p) => ({
                value: `user:${p.id}`,
                label: p.name ?? p.email,
              })),
            ]}
            currentAssignee={
              task.assigneeAgentId
                ? `agent:${task.assigneeAgentId}`
                : task.assigneeUserId
                  ? `user:${task.assigneeUserId}`
                  : "unassigned"
            }
            canManage={can.manageTasks(session.workspace.role)}
            now={Date.now()}
          />
        </div>
      </PageBody>
    </>
  );
}
