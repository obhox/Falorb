"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * The shared board, from a human's side.
 *
 * The mirror image of `@falorb/agents`' task toolkit: the same table, the
 * same statuses, the same comment thread. That symmetry is the product —
 * assigning work to an agent is the same gesture as assigning it to a
 * colleague, and it is deliberately not a different screen, a different verb
 * or a different mental model.
 *
 * Assigning to an agent does not start anything here. The worker's
 * `enqueueAgentTasks` sweep notices the assignment within a minute and opens
 * a run. Kicking off a model call from inside a form post would put a
 * multi-minute, billable operation inside a request/response cycle — the
 * same reasoning `ugc-videos.ts` gives for handing generation to the worker.
 */

const STATUSES = new Set(["todo", "in_progress", "blocked", "review", "done", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export async function createTaskAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageTasks", "create a task");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;

  const title = String(formData.get("title") ?? "").trim();
  if (!title || title.length > 200) {
    return { ok: false, message: "Give the task a title of 1–200 characters." };
  }

  const body = String(formData.get("body") ?? "").trim();
  if (body.length > 10_000) return { ok: false, message: "Keep the description under 10,000 characters." };

  const priority = String(formData.get("priority") ?? "normal");
  if (!PRIORITIES.has(priority)) return { ok: false, message: "Choose a valid priority." };

  /**
   * One control for both kinds of assignee: the form posts "agent:<id>" or
   * "user:<id>". A single dropdown listing people and agents together is the
   * point — two dropdowns would ask the user to decide what kind of thing
   * should do the work before deciding who, which is backwards.
   */
  const assignee = String(formData.get("assignee") ?? "").trim();
  const resolved = await resolveAssignee(orgId, assignee);
  if (resolved.error) return { ok: false, message: resolved.error };

  const projectIdRaw = String(formData.get("projectId") ?? "").trim();
  const projectId = projectIdRaw ? Number(projectIdRaw) : null;
  if (projectId !== null && !session.projects.some((p) => p.id === projectId)) {
    return { ok: false, message: "That property is not in your workspace." };
  }

  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  const dueAt = dueRaw ? new Date(dueRaw) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return { ok: false, message: "That due date is not valid." };

  const [created] = await db()
    .insert(schema.tasks)
    .values({
      organizationId: orgId,
      projectId,
      title,
      body: body || null,
      priority,
      assigneeType: resolved.assigneeType,
      assigneeUserId: resolved.assigneeUserId,
      assigneeAgentId: resolved.assigneeAgentId,
      creatorType: "human",
      creatorUserId: session.user.id,
      dueAt,
    })
    .returning({ id: schema.tasks.id });

  if (resolved.assigneeAgentId) {
    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.taskAssigned,
      targetType: "task",
      targetId: created!.id,
      metadata: { title, agentId: resolved.assigneeAgentId },
    });
  }

  revalidatePath("/tasks");
  return {
    ok: true,
    message: resolved.assigneeAgentId
      ? "Assigned. The agent picks it up within a minute."
      : "Task created.",
  };
}

export async function assignTaskAction(taskId: string, assignee: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageTasks", "reassign a task");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [task] = await db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.organizationId, orgId)))
    .limit(1);
  if (!task) return { ok: false, message: "No such task." };

  const resolved = await resolveAssignee(orgId, assignee);
  if (resolved.error) return { ok: false, message: resolved.error };

  await db()
    .update(schema.tasks)
    .set({
      assigneeType: resolved.assigneeType,
      assigneeUserId: resolved.assigneeUserId,
      assigneeAgentId: resolved.assigneeAgentId,
      // Reassigning resets an in-progress task to `todo` so the worker's
      // sweep picks it up for its new owner. A task left `in_progress` while
      // pointing at a different agent would simply never be worked.
      status: task.status === "in_progress" ? "todo" : task.status,
      startedAt: task.status === "in_progress" ? null : task.startedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId));

  await db().insert(schema.taskComments).values({
    taskId,
    authorType: "system",
    body: resolved.assigneeAgentId
      ? `Reassigned to an agent by ${session.user.name ?? session.user.email}.`
      : resolved.assigneeUserId
        ? `Reassigned by ${session.user.name ?? session.user.email}.`
        : `Unassigned by ${session.user.name ?? session.user.email}.`,
  });

  revalidatePath("/tasks");
  return { ok: true, message: "Reassigned." };
}

export async function setTaskStatusAction(taskId: string, status: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageTasks", "change a task's status");
  if (refusal) return refusal;
  if (!STATUSES.has(status)) return { ok: false, message: "That is not a valid status." };

  const done = status === "done" || status === "cancelled";
  const updated = await db()
    .update(schema.tasks)
    .set({
      status,
      completedAt: done ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.tasks.id, taskId),
        eq(schema.tasks.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ title: schema.tasks.title });
  if (!updated.length) return { ok: false, message: "No such task." };

  if (done) {
    audit(db(), {
      organizationId: session.workspace.organizationId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.taskCompleted,
      targetType: "task",
      targetId: taskId,
      metadata: { title: updated[0]!.title, status },
    });
  }

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true, message: done ? "Closed." : "Updated." };
}

/**
 * Edit a task after it exists.
 *
 * Field-by-field `.has()` checks rather than defaulting a missing key to
 * "clear it": an inline control posts only its own field, and everything
 * else must fall back to the task's current value — the same convention
 * `updateDeal` and `updateAgentAction` follow.
 */
export async function updateTaskAction(
  taskId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageTasks", "edit a task");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [task] = await db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.organizationId, orgId)))
    .limit(1);
  if (!task) return { ok: false, message: "No such task." };

  const patch: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: new Date() };

  if (formData.has("title")) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title || title.length > 200) {
      return { ok: false, message: "Give the task a title of 1–200 characters." };
    }
    patch.title = title;
  }

  if (formData.has("body")) {
    const body = String(formData.get("body") ?? "").trim();
    if (body.length > 10_000) {
      return { ok: false, message: "Keep the description under 10,000 characters." };
    }
    patch.body = body || null;
  }

  if (formData.has("priority")) {
    const priority = String(formData.get("priority") ?? "");
    if (!PRIORITIES.has(priority)) return { ok: false, message: "Choose a valid priority." };
    patch.priority = priority;
  }

  if (formData.has("projectId")) {
    const raw = String(formData.get("projectId") ?? "").trim();
    const projectId = raw ? Number(raw) : null;
    if (projectId !== null && !session.projects.some((p) => p.id === projectId)) {
      return { ok: false, message: "That property is not in your workspace." };
    }
    patch.projectId = projectId;
  }

  if (formData.has("dueAt")) {
    const raw = String(formData.get("dueAt") ?? "").trim();
    if (!raw) {
      patch.dueAt = null;
    } else {
      const dueAt = new Date(raw);
      if (Number.isNaN(dueAt.getTime())) return { ok: false, message: "That due date is not valid." };
      patch.dueAt = dueAt;
    }
  }

  await db().update(schema.tasks).set(patch).where(eq(schema.tasks.id, taskId));

  revalidatePath("/tasks");
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true, message: "Saved." };
}

/**
 * Delete a task outright.
 *
 * Unlike an agent — which is archived so its name survives on everything it
 * did — a task carries no attribution anyone else depends on, and a board
 * that can only ever grow is a board people stop reading. Comments go with
 * it via the cascade.
 */
export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageTasks", "delete a task");
  if (refusal) return refusal;

  const deleted = await db()
    .delete(schema.tasks)
    .where(
      and(
        eq(schema.tasks.id, taskId),
        eq(schema.tasks.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ id: schema.tasks.id });
  if (!deleted.length) return { ok: false, message: "No such task." };

  revalidatePath("/tasks");
  return { ok: true, message: "Deleted." };
}

export async function commentOnTaskAction(taskId: string, body: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageTasks", "comment on a task");
  if (refusal) return refusal;

  const text = body.trim();
  if (!text) return { ok: false, message: "Write something first." };
  if (text.length > 10_000) return { ok: false, message: "Keep comments under 10,000 characters." };

  const [task] = await db()
    .select({ id: schema.tasks.id, assigneeAgentId: schema.tasks.assigneeAgentId, status: schema.tasks.status })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.id, taskId),
        eq(schema.tasks.organizationId, session.workspace.organizationId),
      ),
    )
    .limit(1);
  if (!task) return { ok: false, message: "No such task." };

  await db().insert(schema.taskComments).values({
    taskId,
    authorType: "human",
    authorUserId: session.user.id,
    body: text,
  });

  revalidatePath(`/tasks/${taskId}`);
  return {
    ok: true,
    message: task.assigneeAgentId
      ? "Added. The agent reads the whole thread when it next works this task."
      : "Comment added.",
  };
}

interface ResolvedAssignee {
  assigneeType: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  error?: string;
}

/**
 * Turn the form's `kind:id` value into the three columns, verifying that the
 * target really is in this workspace. An id posted directly to the action —
 * a server action being a public endpoint — must not be able to attach a
 * task to another tenant's agent.
 */
async function resolveAssignee(orgId: string, value: string): Promise<ResolvedAssignee> {
  const empty: ResolvedAssignee = {
    assigneeType: "unassigned",
    assigneeUserId: null,
    assigneeAgentId: null,
  };
  if (!value || value === "unassigned") return empty;

  const [kind, id] = value.split(":");
  if (!id) return { ...empty, error: "That assignee is not valid." };

  if (kind === "agent") {
    const [agent] = await db()
      .select({ id: schema.agents.id, status: schema.agents.status })
      .from(schema.agents)
      .where(and(eq(schema.agents.id, id), eq(schema.agents.organizationId, orgId)))
      .limit(1);
    if (!agent) return { ...empty, error: "No such agent in this workspace." };
    if (agent.status !== "active") {
      return { ...empty, error: "That agent is paused — resume it first, or pick someone else." };
    }
    return { assigneeType: "agent", assigneeUserId: null, assigneeAgentId: agent.id };
  }

  if (kind === "user") {
    const [membership] = await db()
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.organizationId, orgId), eq(schema.memberships.userId, id)),
      )
      .limit(1);
    if (!membership) return { ...empty, error: "That person is not in this workspace." };
    return { assigneeType: "human", assigneeUserId: membership.userId, assigneeAgentId: null };
  }

  return { ...empty, error: "That assignee is not valid." };
}
