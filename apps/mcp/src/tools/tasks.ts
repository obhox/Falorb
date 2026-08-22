import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Database } from "@falorb/db";
import type { McpContext } from "../context";
import { requireCapability, requireScope } from "../context";
import { ago, failure, table, text } from "../format";

const STATUSES = ["todo", "in_progress", "blocked", "review", "done", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const OPEN_STATUSES = ["todo", "in_progress", "blocked", "review"] as const;

/**
 * The shared work board — the same `tasks`/`task_comments` tables a human
 * assigns work on from `/tasks`, and that `packages/agents/src/tools/tasks.ts`
 * reads from an agent's own side. Assigning a task to an agent here does not
 * start anything by itself: the worker's `enqueueAgentTasks` sweep notices
 * the assignment within a minute and opens a run, same as the dashboard.
 *
 * One dropdown, one gesture — a task can go to a specific person, a specific
 * agent, or sit unassigned for anyone to pick up; `assign_task`'s
 * `assignee` argument takes `"user:<id>"`, `"agent:<id>"`, or
 * `"unassigned"`, mirroring the dashboard form's own encoding exactly.
 */

interface ResolvedAssignee {
  assigneeType: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  error?: string;
}

async function resolveAssignee(db: Database, orgId: string, value: string | undefined): Promise<ResolvedAssignee> {
  const empty: ResolvedAssignee = { assigneeType: "unassigned", assigneeUserId: null, assigneeAgentId: null };
  if (!value || value === "unassigned") return empty;

  const [kind, id] = value.split(":");
  if (!id) return { ...empty, error: 'assignee must be "user:<id>", "agent:<id>", or "unassigned".' };

  if (kind === "agent") {
    const [agent] = await db
      .select({ id: schema.agents.id, status: schema.agents.status })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, id), eq(schema.agents.organizationId, orgId)))
      .limit(1);
    if (!agent) return { ...empty, error: "No such agent in this workspace." };
    if (agent.status !== "active") {
      return { ...empty, error: "That agent is paused — resume it first, or assign someone else." };
    }
    return { assigneeType: "agent", assigneeUserId: null, assigneeAgentId: agent.id };
  }

  if (kind === "user") {
    const [membership] = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.organizationId, orgId), eq(schema.memberships.userId, id)))
      .limit(1);
    if (!membership) return { ...empty, error: "That person is not a member of this workspace." };
    return { assigneeType: "human", assigneeUserId: membership.userId, assigneeAgentId: null };
  }

  return { ...empty, error: 'assignee must be "user:<id>", "agent:<id>", or "unassigned".' };
}

async function requireTask(db: Database, orgId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.organizationId, orgId)))
    .limit(1);
  return task ?? null;
}

export function registerTaskTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "The shared work board — human and agent work in one list. Open tasks by default. Filter " +
        "by status or assignee to see one person's or one agent's queue.",
      inputSchema: {
        status: z.enum(STATUSES).optional().describe("Omit for everything still open."),
        assignee_type: z.enum(["human", "agent", "unassigned"]).optional(),
        assignee_agent_id: z.string().optional().describe("Only tasks assigned to this agent."),
        assignee_user_id: z.string().optional().describe("Only tasks assigned to this person."),
        project: z.string().optional().describe("Project slug."),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, assignee_type, assignee_agent_id, assignee_user_id, project, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.tasks.organizationId, scope.organizationId)];
        conditions.push(status ? eq(schema.tasks.status, status) : inArray(schema.tasks.status, [...OPEN_STATUSES]));
        if (assignee_type) conditions.push(eq(schema.tasks.assigneeType, assignee_type));
        if (assignee_agent_id) conditions.push(eq(schema.tasks.assigneeAgentId, assignee_agent_id));
        if (assignee_user_id) conditions.push(eq(schema.tasks.assigneeUserId, assignee_user_id));
        if (project) {
          const match = scope.projects.find((p) => p.slug.toLowerCase() === project.toLowerCase());
          if (!match) return failure(`Unknown project "${project}".`);
          conditions.push(eq(schema.tasks.projectId, match.id));
        }

        const rows = await db
          .select()
          .from(schema.tasks)
          .where(and(...conditions))
          .orderBy(desc(schema.tasks.createdAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Title", get: (r) => r.title },
              { header: "Status", get: (r) => r.status },
              { header: "Priority", get: (r) => r.priority },
              {
                header: "Assignee",
                get: (r) => (r.assigneeType === "agent" ? `agent:${r.assigneeAgentId}` : r.assigneeType === "human" ? `user:${r.assigneeUserId}` : "unassigned"),
              },
              { header: "Handoff reason", get: (r) => r.handoffReason },
              { header: "Due", get: (r) => (r.dueAt ? ago(r.dueAt.toISOString()) : "—") },
              { header: "Created", get: (r) => ago(r.createdAt.toISOString()) },
            ],
            "No tasks match.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_task",
    {
      title: "Read a task",
      description: "One task in full, including its whole comment thread.",
      inputSchema: { task_id: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ task_id }) => {
      const { db, scope } = ctx();
      try {
        const task = await requireTask(db, scope.organizationId, task_id);
        if (!task) return failure("No such task in this workspace.");

        const comments = await db
          .select()
          .from(schema.taskComments)
          .where(eq(schema.taskComments.taskId, task_id))
          .orderBy(schema.taskComments.createdAt);

        const lines = [
          `# ${task.title}`,
          "",
          `Status: **${task.status}**  ·  Priority: ${task.priority}`,
          `Assignee: ${task.assigneeType === "agent" ? `agent ${task.assigneeAgentId}` : task.assigneeType === "human" ? `person ${task.assigneeUserId}` : "unassigned"}`,
          task.handoffReason ? `Handoff reason: ${task.handoffReason}` : null,
          task.body ? `\n${task.body}` : null,
          task.result ? `\nResult: ${task.result}` : null,
          "",
          `### Comments (${comments.length})`,
        ].filter((l): l is string => l !== null);

        return text(
          lines.join("\n") +
            "\n" +
            table(
              comments,
              [
                { header: "By", get: (r) => (r.authorType === "agent" ? `agent ${r.authorAgentId}` : r.authorType === "human" ? `user ${r.authorUserId}` : "system") },
                { header: "When", get: (r) => ago(r.createdAt.toISOString()) },
                { header: "Comment", get: (r) => r.body },
              ],
              "No comments yet.",
            ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Put work on the board",
      description:
        "Create a task, optionally assigned to a specific person or agent. Check list_tasks first " +
        "— the job may already be queued. Requires the write scope.",
      inputSchema: {
        title: z.string().min(3).max(200),
        body: z.string().max(10000).optional(),
        priority: z.enum(PRIORITIES).default("normal"),
        assignee: z.string().optional().describe('"user:<id>", "agent:<id>", or omit for unassigned.'),
        project: z.string().optional().describe("Project slug."),
        due_at: z.string().optional().describe("ISO date/time."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ title, body, priority, assignee, project, due_at }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "manageTasks", "create a task");

        const resolved = await resolveAssignee(db, scope.organizationId, assignee);
        if (resolved.error) return failure(resolved.error);

        let projectId: number | null = null;
        if (project) {
          const match = scope.projects.find((p) => p.slug.toLowerCase() === project.toLowerCase());
          if (!match) return failure(`Unknown project "${project}".`);
          projectId = match.id;
        }

        let dueAt: Date | null = null;
        if (due_at) {
          dueAt = new Date(due_at);
          if (Number.isNaN(dueAt.getTime())) return failure(`"${due_at}" is not a valid date/time.`);
        }

        const [created] = await db
          .insert(schema.tasks)
          .values({
            organizationId: scope.organizationId,
            projectId,
            title,
            body: body ?? null,
            priority,
            assigneeType: resolved.assigneeType,
            assigneeUserId: resolved.assigneeUserId,
            assigneeAgentId: resolved.assigneeAgentId,
            creatorType: "system",
            dueAt,
          })
          .returning({ id: schema.tasks.id });

        return text(
          `Created task \`${created!.id}\`: ${title}` +
            (resolved.assigneeAgentId ? " — the agent picks it up within a minute." : ""),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Edit a task",
      description: "Change a task's title, body, priority, project, or due date. Only the fields you pass are changed. Requires the write scope.",
      inputSchema: {
        task_id: z.string().uuid(),
        title: z.string().min(3).max(200).optional(),
        body: z.string().max(10000).optional(),
        priority: z.enum(PRIORITIES).optional(),
        project: z.string().optional().describe('Project slug, or "" to clear it.'),
        due_at: z.string().optional().describe('ISO date/time, or "" to clear it.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ task_id, title, body, priority, project, due_at }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "manageTasks", "edit a task");
        const task = await requireTask(db, scope.organizationId, task_id);
        if (!task) return failure("No such task in this workspace.");

        const patch: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: new Date() };
        if (title !== undefined) patch.title = title;
        if (body !== undefined) patch.body = body || null;
        if (priority !== undefined) patch.priority = priority;
        if (project !== undefined) {
          if (!project) {
            patch.projectId = null;
          } else {
            const match = scope.projects.find((p) => p.slug.toLowerCase() === project.toLowerCase());
            if (!match) return failure(`Unknown project "${project}".`);
            patch.projectId = match.id;
          }
        }
        if (due_at !== undefined) {
          if (!due_at) {
            patch.dueAt = null;
          } else {
            const parsed = new Date(due_at);
            if (Number.isNaN(parsed.getTime())) return failure(`"${due_at}" is not a valid date/time.`);
            patch.dueAt = parsed;
          }
        }

        await db.update(schema.tasks).set(patch).where(eq(schema.tasks.id, task_id));
        return text("Saved.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "assign_task",
    {
      title: "Reassign a task",
      description:
        "Move a task to a different person, agent, or back to unassigned. Reassigning an " +
        "in-progress task resets it to todo, so the worker's sweep picks it up for its new owner. " +
        "Requires the write scope.",
      inputSchema: {
        task_id: z.string().uuid(),
        assignee: z.string().describe('"user:<id>", "agent:<id>", or "unassigned".'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ task_id, assignee }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "manageTasks", "reassign a task");
        const task = await requireTask(db, scope.organizationId, task_id);
        if (!task) return failure("No such task in this workspace.");

        const resolved = await resolveAssignee(db, scope.organizationId, assignee);
        if (resolved.error) return failure(resolved.error);

        await db
          .update(schema.tasks)
          .set({
            assigneeType: resolved.assigneeType,
            assigneeUserId: resolved.assigneeUserId,
            assigneeAgentId: resolved.assigneeAgentId,
            status: task.status === "in_progress" ? "todo" : task.status,
            startedAt: task.status === "in_progress" ? null : task.startedAt,
            updatedAt: new Date(),
          })
          .where(eq(schema.tasks.id, task_id));

        await db.insert(schema.taskComments).values({
          taskId: task_id,
          authorType: "system",
          body: `Reassigned to ${resolved.assigneeType === "unassigned" ? "nobody" : assignee}.`,
        });

        return text("Reassigned.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_task_status",
    {
      title: "Change a task's status",
      description: "Move a task through the board — todo, in_progress, blocked, review, done, cancelled. Requires the write scope.",
      inputSchema: { task_id: z.string().uuid(), status: z.enum(STATUSES) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ task_id, status }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "manageTasks", "change a task's status");
        const done = status === "done" || status === "cancelled";
        const updated = await db
          .update(schema.tasks)
          .set({ status, completedAt: done ? new Date() : null, updatedAt: new Date() })
          .where(and(eq(schema.tasks.id, task_id), eq(schema.tasks.organizationId, scope.organizationId)))
          .returning({ title: schema.tasks.title });
        if (!updated.length) return failure("No such task.");
        return text(done ? `Closed: ${updated[0]!.title}` : `Updated to ${status}.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "comment_on_task",
    {
      title: "Comment on a task",
      description: "Add to a task's thread — progress, a finding, a question for whoever owns it. Requires the write scope.",
      inputSchema: { task_id: z.string().uuid(), body: z.string().min(1).max(10000) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ task_id, body }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "manageTasks", "comment on a task");
        const task = await requireTask(db, scope.organizationId, task_id);
        if (!task) return failure("No such task in this workspace.");

        await db.insert(schema.taskComments).values({ taskId: task_id, authorType: "system", body });
        return text("Comment added.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete a task",
      description: "Delete a task outright, including its comment thread. Requires the write scope.",
      inputSchema: { task_id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ task_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "manageTasks", "delete a task");
        const deleted = await db
          .delete(schema.tasks)
          .where(and(eq(schema.tasks.id, task_id), eq(schema.tasks.organizationId, scope.organizationId)))
          .returning({ id: schema.tasks.id });
        if (!deleted.length) return failure("No such task.");
        return text("Deleted.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
