import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { executeApproval, executeRun } from "@falorb/agents";
import { schema } from "@falorb/db";
import type { WorkerContext } from "../context";

/**
 * The shift system: what makes an agent an employee rather than a button.
 *
 * Four sweeps, each idempotent and each safe to run twice, in keeping with
 * every other job in this directory:
 *
 *   `enqueueDueAgents`   an agent whose shift has come round gets a run.
 *   `enqueueAgentTasks`  work assigned to an agent becomes a run.
 *   `runQueuedAgentRuns` queued runs are executed, oldest first.
 *   `settleApprovals`    approved actions are carried out; stale ones expire.
 *
 * Enqueue and execute are separate on purpose. A run exists as a durable row
 * from the moment it is due, so a worker that dies mid-shift leaves a visible
 * `running` run with a stale heartbeat rather than an agent that silently
 * skipped a night. That row is reclaimed below and re-executed — and because
 * `@falorb/agents` rebuilds the transcript from `agent_steps`, the retry
 * resumes rather than starting the (billed) shift over.
 *
 * `nextRunAt` is advanced when the run is *enqueued*, not when it finishes.
 * Advancing on completion would let a long or wedged run push the whole
 * schedule later and later until a "daily" agent quietly became a weekly
 * one.
 */

/** A run whose worker has gone silent for this long is presumed dead. */
const HEARTBEAT_TIMEOUT_MS = 10 * 60_000;
/** Executed per sweep. Small: each is several model calls and paid for. */
const RUNS_PER_SWEEP = 3;

export async function enqueueDueAgents(context: WorkerContext): Promise<void> {
  const now = new Date();

  const due = await context.db
    .select()
    .from(schema.agents)
    .where(
      and(
        eq(schema.agents.status, "active"),
        sql`${schema.agents.scheduleMinutes} is not null`,
        or(isNull(schema.agents.nextRunAt), lt(schema.agents.nextRunAt, now)),
      ),
    )
    .limit(50);

  for (const agent of due) {
    const next = new Date(now.getTime() + (agent.scheduleMinutes ?? 1440) * 60_000);

    // Claim the slot before doing anything else. Two workers reaching this
    // agent in the same tick both pass the query above; only the one whose
    // update matches the `nextRunAt` it read gets to create the run.
    const claimed = await context.db
      .update(schema.agents)
      .set({ nextRunAt: next })
      .where(
        and(
          eq(schema.agents.id, agent.id),
          agent.nextRunAt
            ? eq(schema.agents.nextRunAt, agent.nextRunAt)
            : isNull(schema.agents.nextRunAt),
        ),
      )
      .returning({ id: schema.agents.id });
    if (!claimed.length) continue;

    await context.db.insert(schema.agentRuns).values({
      organizationId: agent.organizationId,
      agentId: agent.id,
      trigger: "schedule",
      objective:
        agent.scheduleObjective?.trim() ||
        "Do your regular round: review what has changed in your area since your last shift, and act on anything that needs it.",
    });
    console.log(`[agents] queued scheduled run for ${agent.name}`);
  }
}

/**
 * Work assigned to an agent becomes a shift.
 *
 * The task is moved to `in_progress` in the same breath as the run is
 * created, which is what stops the next sweep from queueing a second run for
 * the same task. It is the assignment itself that is the trigger — there is
 * no separate "start" action a human has to remember, because handing a task
 * to a colleague and expecting them to begin is the whole convention being
 * modelled.
 */
export async function enqueueAgentTasks(context: WorkerContext): Promise<void> {
  const waiting = await context.db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      organizationId: schema.tasks.organizationId,
      agentId: schema.tasks.assigneeAgentId,
      creatorType: schema.tasks.creatorType,
    })
    .from(schema.tasks)
    .innerJoin(schema.agents, eq(schema.tasks.assigneeAgentId, schema.agents.id))
    .where(
      and(
        eq(schema.tasks.assigneeType, "agent"),
        eq(schema.tasks.status, "todo"),
        eq(schema.agents.status, "active"),
      ),
    )
    .orderBy(asc(schema.tasks.createdAt))
    .limit(25);

  for (const task of waiting) {
    if (!task.agentId) continue;

    const claimed = await context.db
      .update(schema.tasks)
      .set({ status: "in_progress", startedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.status, "todo")))
      .returning({ id: schema.tasks.id });
    if (!claimed.length) continue;

    // A human assigning work to an agent and an agent delegating to another
    // agent both land here as the same kind of row (`assigneeType: "agent"`,
    // `status: "todo"`) — `creatorType` is what tells them apart, and it is
    // what makes the two distinguishable afterward in `agent_runs`.
    const trigger = task.creatorType === "agent" ? "delegation" : "task";

    await context.db.insert(schema.agentRuns).values({
      organizationId: task.organizationId,
      agentId: task.agentId,
      trigger,
      triggerRef: task.id,
      taskId: task.id,
      objective: `Work the task you have been assigned: "${task.title}".`,
    });
    console.log(`[agents] queued ${trigger} run: ${task.title}`);
  }
}

export async function runQueuedAgentRuns(context: WorkerContext): Promise<void> {
  await reclaimStalledRuns(context);

  const queued = await context.db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.status, "queued"))
    .orderBy(asc(schema.agentRuns.createdAt))
    .limit(RUNS_PER_SWEEP);

  for (const { id } of queued) {
    // Claim by transitioning out of `queued`; a second worker's update
    // matches nothing and it moves on.
    const claimed = await context.db
      .update(schema.agentRuns)
      .set({ status: "running", startedAt: new Date(), heartbeatAt: new Date() })
      .where(and(eq(schema.agentRuns.id, id), eq(schema.agentRuns.status, "queued")))
      .returning({ id: schema.agentRuns.id });
    if (!claimed.length) continue;

    try {
      const outcome = await executeRun(
        {
          db: context.db,
          clickhouse: context.clickhouse,
          onLog: (runId, message) => console.log(`[agents:${runId.slice(0, 8)}] ${message}`),
        },
        id,
      );
      console.log(`[agents] run ${id.slice(0, 8)} ${outcome.status} in ${outcome.steps} steps`);
      await closeTaskIfAbandoned(context, id);
    } catch (error) {
      // executeRun records its own failures; this only catches something
      // going wrong outside the loop, which must not stop the sweep.
      console.error(`[agents] run ${id.slice(0, 8)} threw:`, String(error));
      await context.db
        .update(schema.agentRuns)
        .set({
          status: "failed",
          error: String(error),
          finishedAt: new Date(),
          heartbeatAt: null,
        })
        .where(eq(schema.agentRuns.id, id));
    }
  }
}

/**
 * A task run that ended without the agent closing its task.
 *
 * The agent may have deliberately left it open — commented and handed part
 * of it over — so this does not close it. It moves it back to `todo` only if
 * the agent left no trace at all, which would otherwise strand the task in
 * `in_progress` forever with nobody working it.
 */
async function closeTaskIfAbandoned(context: WorkerContext, runId: string): Promise<void> {
  const [run] = await context.db
    .select({ taskId: schema.agentRuns.taskId, status: schema.agentRuns.status })
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, runId))
    .limit(1);
  if (!run?.taskId || run.status !== "failed") return;

  await context.db
    .update(schema.tasks)
    .set({ status: "todo", startedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.tasks.id, run.taskId), eq(schema.tasks.status, "in_progress")));
}

async function reclaimStalledRuns(context: WorkerContext): Promise<void> {
  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  const stalled = await context.db
    .update(schema.agentRuns)
    .set({ status: "queued", heartbeatAt: null })
    .where(and(eq(schema.agentRuns.status, "running"), lt(schema.agentRuns.heartbeatAt, cutoff)))
    .returning({ id: schema.agentRuns.id });

  if (stalled.length) {
    console.warn(`[agents] reclaimed ${stalled.length} stalled run(s) for retry`);
  }
}

/**
 * Carry out decisions, and expire the undecided.
 *
 * Expiry is not tidiness. "Send this follow-up" agreed on Monday should not
 * fire on Friday against numbers nobody has re-read, and an approval queue
 * that silently accumulates weeks of live, executable actions is a hazard
 * rather than a safety feature.
 */
export async function settleApprovals(context: WorkerContext): Promise<void> {
  const expired = await context.db
    .update(schema.agentApprovals)
    .set({ status: "expired" })
    .where(
      and(
        eq(schema.agentApprovals.status, "pending"),
        lt(schema.agentApprovals.expiresAt, new Date()),
      ),
    )
    .returning({ id: schema.agentApprovals.id });
  if (expired.length) console.log(`[agents] expired ${expired.length} undecided approval(s)`);

  const approved = await context.db
    .select({ id: schema.agentApprovals.id, title: schema.agentApprovals.title })
    .from(schema.agentApprovals)
    .where(eq(schema.agentApprovals.status, "approved"))
    .orderBy(asc(schema.agentApprovals.decidedAt))
    .limit(20);

  for (const approval of approved) {
    const result = await executeApproval(
      { db: context.db, clickhouse: context.clickhouse },
      approval.id,
    );
    console.log(
      `[agents] approval "${approval.title}" ${result.ok ? "executed" : `failed: ${result.detail}`}`,
    );
  }

  await closeSettledRuns(context);
}

/**
 * A run marked `waiting_approval` whose approvals have all been decided is
 * simply finished — the shift ended long ago, and leaving it labelled
 * "waiting" makes the dashboard permanently look like something is
 * outstanding when nothing is.
 */
async function closeSettledRuns(context: WorkerContext): Promise<void> {
  await context.db
    .update(schema.agentRuns)
    .set({ status: "succeeded" })
    .where(
      and(
        eq(schema.agentRuns.status, "waiting_approval"),
        sql`not exists (
          select 1 from ${schema.agentApprovals}
          where ${schema.agentApprovals.runId} = ${schema.agentRuns.id}
            and ${schema.agentApprovals.status} = 'pending'
        )`,
      ),
    );
}
