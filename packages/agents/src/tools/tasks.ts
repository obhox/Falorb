import { z } from "zod";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, schema } from "@falorb/db";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * The shared board — the toolkit that makes an agent a colleague rather than
 * a scheduled script.
 *
 * `hand_to_human` is the single most important tool in the whole runtime,
 * and it is worth being explicit about why. Every other design decision here
 * assumes an agent will regularly hit something it cannot or should not do:
 * a capability its role denies, a credential nobody has connected, a
 * judgement call about a customer, or a real-world action — a phone call, a
 * signature, a conversation — that no amount of API access reaches. Without
 * a first-class way to hand that over, an agent's only options are to give
 * up silently or to improvise around the obstacle, and the second is far
 * worse than the first. With one, "I can't do this" becomes a routed piece
 * of work with a stated reason, which is exactly what a competent employee
 * does.
 *
 * Note the effect grades: reading and commenting are cheap, creating work is
 * `internal`, and closing something out is too. An assisted agent therefore
 * asks before it puts anything on anyone's list — which sounds
 * over-cautious until the first time an agent decides the fix for a bad
 * afternoon is forty tasks.
 */

const STATUSES = ["todo", "in_progress", "blocked", "review", "done", "cancelled"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/**
 * How many agent-to-agent hops a task may accumulate before `delegate_task`
 * refuses and points at `hand_to_human` instead.
 *
 * A delegation chain (or a ping-pong between two agents) is the one failure
 * mode here with no natural end on its own — unlike a human, an agent never
 * gets tired of re-delegating. `tasks.delegationDepth` is monotonically
 * increasing, so this one constant bounds every possible shape of loop
 * without needing cycle detection.
 */
export const MAX_DELEGATION_DEPTH = 3;

/**
 * Pure precondition check for `delegate_task`, pulled out of `execute` so it
 * can be tested without a database. Returns a refusal message, or null if
 * the delegation may proceed.
 */
export function checkDelegation(
  currentDepth: number,
  requestingAgentId: string,
  targetAgentId: string,
): string | null {
  if (targetAgentId === requestingAgentId) {
    return "You cannot delegate a task to yourself.";
  }
  if (currentDepth + 1 > MAX_DELEGATION_DEPTH) {
    return (
      `This would be the ${currentDepth + 1}th hop in a delegation chain, past the limit of ` +
      `${MAX_DELEGATION_DEPTH}. Hand this to a human instead of delegating it further.`
    );
  }
  return null;
}

async function requireTask(ctx: AgentContext, taskId: string) {
  const [task] = await ctx.db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.organizationId, ctx.organizationId)))
    .limit(1);
  if (!task) throw new Error("No such task in this workspace.");
  return task;
}

export const taskTools: AnyToolDefinition[] = [
  defineTool({
    name: "list_tasks",
    toolkit: "tasks",
    description:
      "Work on the shared board. Defaults to what is open and assigned to you. Check this " +
      "before creating anything — the job may already be queued, and a duplicate task costs " +
      "a colleague more than a missing one.",
    input: z.object({
      scope: z
        .enum(["mine", "unassigned", "all"])
        .default("mine")
        .describe("'mine' is work assigned to this agent."),
      status: z.enum(STATUSES).optional().describe("Omit for everything still open."),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `List ${a.scope} tasks`,
    execute: async (ctx, a) => {
      const conditions = [eq(schema.tasks.organizationId, ctx.organizationId)];
      if (a.scope === "mine") conditions.push(eq(schema.tasks.assigneeAgentId, ctx.agent.id));
      if (a.scope === "unassigned") conditions.push(eq(schema.tasks.assigneeType, "unassigned"));
      conditions.push(
        a.status
          ? eq(schema.tasks.status, a.status)
          : inArray(schema.tasks.status, ["todo", "in_progress", "blocked", "review"]),
      );

      return ctx.db
        .select({
          id: schema.tasks.id,
          title: schema.tasks.title,
          body: schema.tasks.body,
          status: schema.tasks.status,
          priority: schema.tasks.priority,
          assigneeType: schema.tasks.assigneeType,
          dueAt: schema.tasks.dueAt,
          handoffReason: schema.tasks.handoffReason,
          relatedType: schema.tasks.relatedType,
          relatedId: schema.tasks.relatedId,
          createdAt: schema.tasks.createdAt,
        })
        .from(schema.tasks)
        .where(and(...conditions))
        .orderBy(desc(schema.tasks.createdAt))
        .limit(a.limit);
    },
  }),

  defineTool({
    name: "read_task",
    toolkit: "tasks",
    description:
      "One task in full, including its whole comment thread. Always read this before working " +
      "a task you were assigned — the thread is where a human redirects you after the title " +
      "was written.",
    input: z.object({ taskId: z.string().uuid() }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Read task ${a.taskId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const task = await requireTask(ctx, a.taskId);
      const comments = await ctx.db
        .select({
          authorType: schema.taskComments.authorType,
          body: schema.taskComments.body,
          createdAt: schema.taskComments.createdAt,
        })
        .from(schema.taskComments)
        .where(eq(schema.taskComments.taskId, a.taskId))
        .orderBy(schema.taskComments.createdAt);
      return { task, comments };
    },
  }),

  defineTool({
    name: "create_task",
    toolkit: "tasks",
    description:
      "Put a piece of work on the board. Leave it unassigned if anyone could pick it up, or " +
      "name a specific person. State the outcome you want, not the steps — whoever takes it " +
      "may know a better route than you do.",
    input: z.object({
      title: z.string().min(3).max(200),
      body: z.string().max(5000).optional().describe("The context, the evidence, what 'done' means."),
      priority: z.enum(PRIORITIES).default("normal"),
      assignToUserId: z.string().optional().describe("Omit to leave it unassigned."),
      projectSlug: z.string().optional(),
      relatedType: z.enum(["person", "contact", "escalation", "deal", "project"]).optional(),
      relatedId: z.string().optional(),
    }),
    capability: "manageTasks",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Create task: ${a.title}`,
    execute: async (ctx, a) => {
      const project = a.projectSlug
        ? ctx.projects.find((p) => p.slug.toLowerCase() === a.projectSlug!.toLowerCase())
        : undefined;
      if (a.projectSlug && !project) throw new Error(`Unknown property "${a.projectSlug}".`);

      const [row] = await ctx.db
        .insert(schema.tasks)
        .values({
          organizationId: ctx.organizationId,
          projectId: project?.id ?? null,
          title: a.title,
          body: a.body ?? null,
          priority: a.priority,
          assigneeType: a.assignToUserId ? "human" : "unassigned",
          assigneeUserId: a.assignToUserId ?? null,
          creatorType: "agent",
          creatorAgentId: ctx.agent.id,
          relatedType: a.relatedType ?? null,
          relatedId: a.relatedId ?? null,
        })
        .returning({ id: schema.tasks.id });

      ctx.log(`Opened task: ${a.title}`);
      return { taskId: row!.id };
    },
  }),

  defineTool({
    name: "hand_to_human",
    toolkit: "tasks",
    description:
      "Hand work to a person, stating plainly why you cannot do it yourself. Use this the " +
      "moment you hit a wall — a permission you lack, a credential nobody has connected, a " +
      "judgement call that should not be yours, or something that happens outside any " +
      "software. Do not work around the wall, and do not quietly drop the job.",
    input: z.object({
      title: z.string().min(3).max(200).describe("What needs doing, as an instruction."),
      reason: z
        .string()
        .min(10)
        .max(1000)
        .describe("Why it has to be a human. Be specific — 'I have no LinkedIn URL for them and cannot browse' beats 'I cannot do this'."),
      context: z.string().max(5000).optional().describe("Everything you already found out, so they do not repeat your work."),
      priority: z.enum(PRIORITIES).default("normal"),
      assignToUserId: z.string().optional(),
      relatedType: z.enum(["person", "contact", "escalation", "deal", "project"]).optional(),
      relatedId: z.string().optional(),
    }),
    capability: "manageTasks",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Hand to a human: ${a.title}`,
    execute: async (ctx, a) => {
      const [row] = await ctx.db
        .insert(schema.tasks)
        .values({
          organizationId: ctx.organizationId,
          title: a.title,
          body: a.context ?? null,
          priority: a.priority,
          status: "todo",
          assigneeType: "human",
          assigneeUserId: a.assignToUserId ?? null,
          creatorType: "agent",
          creatorAgentId: ctx.agent.id,
          handoffReason: a.reason,
          relatedType: a.relatedType ?? null,
          relatedId: a.relatedId ?? null,
        })
        .returning({ id: schema.tasks.id });

      audit(ctx.db, {
        organizationId: ctx.organizationId,
        actorAgentId: ctx.agent.id,
        action: AUDIT_ACTIONS.taskAssigned,
        targetType: "task",
        targetId: row!.id,
        metadata: { handoff: true, reason: a.reason, runId: ctx.runId },
      });

      ctx.log(`Handed to a human: ${a.title}`);
      return { taskId: row!.id, note: "A person will pick this up. Do not attempt it yourself." };
    },
  }),

  defineTool({
    name: "delegate_task",
    toolkit: "tasks",
    description:
      "Assign a piece of work directly to another agent, the same way a human would pick a " +
      "colleague from the assignee list. Use this only when the target agent's own toolkits " +
      "genuinely cover the work — delegating something outside its skillset just becomes a " +
      "handoff at one remove. Chains have a hard depth limit; past it, use hand_to_human.",
    input: z.object({
      title: z.string().min(3).max(200),
      body: z.string().max(5000).optional().describe("The context, the evidence, what 'done' means."),
      priority: z.enum(PRIORITIES).default("normal"),
      assignToAgentId: z.string().uuid(),
      relatedType: z.enum(["person", "contact", "escalation", "deal", "project"]).optional(),
      relatedId: z.string().optional(),
    }),
    capability: "manageTasks",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Delegate to another agent: ${a.title}`,
    execute: async (ctx, a) => {
      const [run] = await ctx.db
        .select({ taskId: schema.agentRuns.taskId })
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.id, ctx.runId))
        .limit(1);

      const currentTask = run?.taskId ? await requireTask(ctx, run.taskId) : null;
      const currentDepth = currentTask?.delegationDepth ?? 0;

      const refusal = checkDelegation(currentDepth, ctx.agent.id, a.assignToAgentId);
      if (refusal) throw new Error(refusal);

      const [target] = await ctx.db
        .select({ id: schema.agents.id, name: schema.agents.name, status: schema.agents.status })
        .from(schema.agents)
        .where(
          and(
            eq(schema.agents.id, a.assignToAgentId),
            eq(schema.agents.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!target) throw new Error("No such agent in this workspace.");
      if (target.status !== "active") {
        throw new Error(`${target.name} is not active and cannot pick up new work.`);
      }

      const [row] = await ctx.db
        .insert(schema.tasks)
        .values({
          organizationId: ctx.organizationId,
          title: a.title,
          body: a.body ?? null,
          priority: a.priority,
          assigneeType: "agent",
          assigneeAgentId: a.assignToAgentId,
          creatorType: "agent",
          creatorAgentId: ctx.agent.id,
          parentTaskId: currentTask?.id ?? null,
          delegationDepth: currentDepth + 1,
          relatedType: a.relatedType ?? null,
          relatedId: a.relatedId ?? null,
        })
        .returning({ id: schema.tasks.id });

      audit(ctx.db, {
        organizationId: ctx.organizationId,
        actorAgentId: ctx.agent.id,
        action: AUDIT_ACTIONS.taskAssigned,
        targetType: "task",
        targetId: row!.id,
        metadata: { delegatedTo: a.assignToAgentId, runId: ctx.runId },
      });

      ctx.log(`Delegated to ${target.name}: ${a.title}`);
      return { taskId: row!.id, delegatedTo: target.name };
    },
  }),

  defineTool({
    name: "comment_on_task",
    toolkit: "tasks",
    description:
      "Add to a task's thread — progress, a finding, a question for whoever owns it. This is " +
      "how you talk to your colleagues.",
    input: z.object({ taskId: z.string().uuid(), body: z.string().min(1).max(5000) }),
    capability: "manageTasks",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Comment on task ${a.taskId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      await requireTask(ctx, a.taskId);
      await ctx.db.insert(schema.taskComments).values({
        taskId: a.taskId,
        authorType: "agent",
        authorAgentId: ctx.agent.id,
        body: a.body,
      });
      return { ok: true };
    },
  }),

  defineTool({
    name: "complete_task",
    toolkit: "tasks",
    description:
      "Close a task you finished, with a result describing what you actually did. Only close " +
      "work that is genuinely done — if you got most of the way, comment and hand the rest " +
      "over instead.",
    input: z.object({
      taskId: z.string().uuid(),
      result: z.string().min(5).max(5000),
      outcome: z.enum(["done", "cancelled"]).default("done"),
    }),
    capability: "manageTasks",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Close task ${a.taskId.slice(0, 8)} as ${a.outcome}`,
    execute: async (ctx, a) => {
      const task = await requireTask(ctx, a.taskId);
      if (task.assigneeAgentId !== ctx.agent.id) {
        throw new Error(
          "That task is not assigned to you. Comment on it instead of closing someone else's work.",
        );
      }

      await ctx.db
        .update(schema.tasks)
        .set({
          status: a.outcome,
          result: a.result,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.tasks.id, a.taskId));

      await ctx.db.insert(schema.taskComments).values({
        taskId: a.taskId,
        authorType: "agent",
        authorAgentId: ctx.agent.id,
        body: a.result,
      });

      audit(ctx.db, {
        organizationId: ctx.organizationId,
        actorAgentId: ctx.agent.id,
        action: AUDIT_ACTIONS.taskCompleted,
        targetType: "task",
        targetId: a.taskId,
        metadata: { outcome: a.outcome, runId: ctx.runId },
      });

      ctx.log(`Closed task: ${task.title}`);
      return { ok: true };
    },
  }),
];
