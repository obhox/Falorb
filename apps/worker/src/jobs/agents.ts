import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { executeApproval, executeRun } from "@falorb/agents";
import { schema } from "@falorb/db";
import { approvalsMail, mailer } from "@falorb/mailer";
import type { WorkerContext } from "../context";
import { sendToChannel } from "../channels";

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
 *
 * **Stopping.** Every sweep consults two stops before touching anything: the
 * workspace's `organizations.automationPausedAt` (the kill switch) and the
 * agent's own `status`. Both are checked at *execution* as well as at
 * enqueue — a paused agent with a backlog of queued runs must not keep
 * firing them, and an approval a person granted before the pause must not
 * be carried out during it. Paused work is left where it is, not dropped;
 * `@falorb/agents`' `executeRun` enforces the same stops again internally
 * so that the verify script and MCP cannot route around the worker.
 */

/** Non-null means the workspace's automation is stopped. */
const orgNotPaused = isNull(schema.organizations.automationPausedAt);

/** A run whose worker has gone silent for this long is presumed dead. */
const HEARTBEAT_TIMEOUT_MS = 10 * 60_000;
/** Executed per sweep. Small: each is several model calls and paid for. */
const RUNS_PER_SWEEP = 3;

export async function enqueueDueAgents(context: WorkerContext): Promise<void> {
  const now = new Date();

  const due = await context.db
    .select({ agent: schema.agents })
    .from(schema.agents)
    .innerJoin(schema.organizations, eq(schema.agents.organizationId, schema.organizations.id))
    .where(
      and(
        eq(schema.agents.status, "active"),
        orgNotPaused,
        sql`${schema.agents.scheduleMinutes} is not null`,
        or(isNull(schema.agents.nextRunAt), lt(schema.agents.nextRunAt, now)),
      ),
    )
    .limit(50);

  for (const { agent } of due) {
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
    .innerJoin(schema.organizations, eq(schema.agents.organizationId, schema.organizations.id))
    .where(
      and(
        eq(schema.tasks.assigneeType, "agent"),
        eq(schema.tasks.status, "todo"),
        eq(schema.agents.status, "active"),
        orgNotPaused,
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

  // Joined to the agent and its workspace so a paused agent's (or a paused
  // workspace's) backlog is simply not selected. Those rows stay `queued`
  // and are picked up when the pause lifts — `executeRun` checks the same
  // two things again once claimed, so a pause that lands between this
  // query and the claim still holds.
  const queued = await context.db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .innerJoin(schema.agents, eq(schema.agentRuns.agentId, schema.agents.id))
    .innerJoin(schema.organizations, eq(schema.agents.organizationId, schema.organizations.id))
    .where(
      and(
        eq(schema.agentRuns.status, "queued"),
        eq(schema.agents.status, "active"),
        orgNotPaused,
      ),
    )
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
 *
 * But expiry is also not the end of the matter. An expired request is work
 * the agent wanted done and the organisation never answered — so each one
 * becomes a task on the board for a person, and the run it came from is
 * marked `needs_attention` rather than quietly filed as a success.
 */
export async function settleApprovals(context: WorkerContext): Promise<void> {
  await notifyNewApprovals(context);

  const expired = await context.db
    .update(schema.agentApprovals)
    .set({ status: "expired" })
    .where(
      and(
        eq(schema.agentApprovals.status, "pending"),
        lt(schema.agentApprovals.expiresAt, new Date()),
      ),
    )
    .returning({
      id: schema.agentApprovals.id,
      organizationId: schema.agentApprovals.organizationId,
      agentId: schema.agentApprovals.agentId,
      runId: schema.agentApprovals.runId,
      title: schema.agentApprovals.title,
      rationale: schema.agentApprovals.rationale,
      toolName: schema.agentApprovals.toolName,
    });
  if (expired.length) {
    console.log(`[agents] expired ${expired.length} undecided approval(s)`);
    await handExpiredToHumans(context, expired);
  }

  // Only for active agents in un-paused workspaces. An approval granted
  // before a pause sits as `approved` until the pause lifts; `executeApproval`
  // re-checks the same two conditions and refuses if they changed in between.
  const approved = await context.db
    .select({ id: schema.agentApprovals.id, title: schema.agentApprovals.title })
    .from(schema.agentApprovals)
    .innerJoin(schema.agents, eq(schema.agentApprovals.agentId, schema.agents.id))
    .innerJoin(schema.organizations, eq(schema.agents.organizationId, schema.organizations.id))
    .where(
      and(
        eq(schema.agentApprovals.status, "approved"),
        eq(schema.agents.status, "active"),
        orgNotPaused,
      ),
    )
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

/** How long a freshly raised approval may wait for its shift to end before
 * being announced anyway. Keeps one shift to one email without letting a
 * long-running shift hold the notice hostage. */
const NOTIFY_SETTLE_MS = 10 * 60_000;

/**
 * Tell the people who can decide that something is waiting.
 *
 * This is the half of the approval design that was missing: the queue only
 * works as a safety gate if a human actually looks at it, and "look at the
 * dashboard within 72 hours or the action is dropped" is not a system
 * anyone can be expected to keep up with unprompted. Owners and admins get
 * one batched email per workspace per sweep; a workspace that has named an
 * `approvalNotifyChannelId` also gets the same notice on Slack / a webhook.
 *
 * Announced once a request's shift has finished (or it has waited
 * `NOTIFY_SETTLE_MS`), so one shift's several requests arrive as one
 * message. `notifiedAt` is set whether or not every delivery succeeded — a
 * channel that is down should not cause the same notice to be re-sent every
 * minute to the channels that are up.
 */
async function notifyNewApprovals(context: WorkerContext): Promise<void> {
  const settledBefore = new Date(Date.now() - NOTIFY_SETTLE_MS);
  const fresh = await context.db
    .select({
      id: schema.agentApprovals.id,
      organizationId: schema.agentApprovals.organizationId,
      title: schema.agentApprovals.title,
      risk: schema.agentApprovals.risk,
      expiresAt: schema.agentApprovals.expiresAt,
      agentName: schema.agents.name,
      orgName: schema.organizations.name,
      channelId: schema.organizations.approvalNotifyChannelId,
    })
    .from(schema.agentApprovals)
    .innerJoin(schema.agents, eq(schema.agentApprovals.agentId, schema.agents.id))
    .innerJoin(schema.organizations, eq(schema.agentApprovals.organizationId, schema.organizations.id))
    .innerJoin(schema.agentRuns, eq(schema.agentApprovals.runId, schema.agentRuns.id))
    .where(
      and(
        eq(schema.agentApprovals.status, "pending"),
        isNull(schema.agentApprovals.notifiedAt),
        or(
          sql`${schema.agentRuns.status} <> 'running'`,
          lt(schema.agentApprovals.createdAt, settledBefore),
        ),
      ),
    )
    .orderBy(asc(schema.agentApprovals.createdAt))
    .limit(200);
  if (!fresh.length) return;

  const byOrg = new Map<string, typeof fresh>();
  for (const row of fresh) {
    const list = byOrg.get(row.organizationId) ?? [];
    list.push(row);
    byOrg.set(row.organizationId, list);
  }

  const app = process.env.FALORB_APP_URL?.replace(/\/$/, "");
  const url = app ? `${app}/agents/approvals` : undefined;

  for (const [organizationId, items] of byOrg) {
    const orgName = items[0]!.orgName;
    const summary = items.map((i) => ({
      agentName: i.agentName,
      title: i.title,
      risk: i.risk,
      expiresAt: i.expiresAt,
    }));

    const recipients = await context.db
      .select({ email: schema.user.email })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
      .where(
        and(
          eq(schema.memberships.organizationId, organizationId),
          or(eq(schema.memberships.role, "owner"), eq(schema.memberships.role, "admin")),
        ),
      );

    let delivered = 0;
    for (const { email } of recipients) {
      try {
        if (await mailer().send(approvalsMail(email, orgName, summary, url))) delivered++;
      } catch (error) {
        console.error(`[agents] approval notice to ${email} failed:`, String(error));
      }
    }

    const channelId = items[0]!.channelId;
    if (channelId) {
      const [channel] = await context.db
        .select()
        .from(schema.alertChannels)
        .where(
          and(
            eq(schema.alertChannels.id, channelId),
            // The column is not a foreign key; make sure the channel is
            // still this workspace's before posting its approvals to it.
            eq(schema.alertChannels.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (channel) {
        try {
          const lines = summary.map((s) => `• ${s.agentName}: ${s.title} (${s.risk} risk)`);
          const ok = await sendToChannel(channel, {
            title:
              summary.length === 1
                ? `${summary[0]!.agentName} is waiting on a decision`
                : `${summary.length} agent actions are waiting on a decision`,
            message: [`Agent requests awaiting approval in ${orgName}:`, ...lines].join("\n"),
            url,
            webhookBody: { event: "agent.approvals_pending", organization: orgName, items: summary, url },
          });
          if (ok) delivered++;
        } catch (error) {
          console.error(`[agents] approval notice to channel ${channelId} failed:`, String(error));
        }
      }
    }

    await context.db
      .update(schema.agentApprovals)
      .set({ notifiedAt: new Date() })
      .where(
        inArray(
          schema.agentApprovals.id,
          items.map((i) => i.id),
        ),
      );
    console.log(
      `[agents] told ${delivered} recipient(s) about ${items.length} pending approval(s) in ${orgName}`,
    );
  }
}

/**
 * An expired approval becomes a task for a person.
 *
 * The agent's request was reasonable enough to queue; nobody answered. That
 * is the organisation's dropped ball, and the board is where dropped balls
 * are supposed to be visible. The task is system-authored, unassigned, and
 * carries the agent's own rationale so whoever picks it up does not have to
 * find the transcript.
 */
async function handExpiredToHumans(
  context: WorkerContext,
  expired: Array<{
    id: string;
    organizationId: string;
    agentId: string;
    runId: string;
    title: string;
    rationale: string | null;
    toolName: string;
  }>,
): Promise<void> {
  const agentIds = [...new Set(expired.map((e) => e.agentId))];
  const agents = await context.db
    .select({ id: schema.agents.id, name: schema.agents.name })
    .from(schema.agents)
    .where(inArray(schema.agents.id, agentIds));
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));

  await context.db.insert(schema.tasks).values(
    expired.map((e) => ({
      organizationId: e.organizationId,
      title: `Undecided: ${e.title}`,
      body:
        `${nameOf.get(e.agentId) ?? "An agent"} asked to do this (${e.toolName}) and nobody ` +
        `approved or rejected it before it expired, so it was not done.\n\n` +
        (e.rationale ? `The agent's reasoning: ${e.rationale}\n\n` : "") +
        `If it is still worth doing, do it by hand or ask the agent to propose it again. ` +
        `If it is not, close this task.`,
      priority: "normal",
      status: "todo",
      assigneeType: "unassigned",
      creatorType: "system",
      creatorAgentId: e.agentId,
      handoffReason: "An approval request expired with no decision.",
      relatedType: "agent_approval",
      relatedId: e.id,
    })),
  );
}

/**
 * A run marked `waiting_approval` whose approvals have all been settled is
 * finished — the shift ended long ago, and leaving it labelled "waiting"
 * makes the dashboard permanently look like something is outstanding.
 *
 * Settled means no approval is still `pending` *or* `approved`-but-not-yet-
 * executed. What it becomes depends on how they settled: all carried out or
 * deliberately rejected is `succeeded`; any that expired undecided or failed
 * in execution is `needs_attention`, because from the agent's side the job
 * is not done and from a manager's side that is the thing to look at.
 */
async function closeSettledRuns(context: WorkerContext): Promise<void> {
  const settled = and(
    eq(schema.agentRuns.status, "waiting_approval"),
    sql`not exists (
      select 1 from ${schema.agentApprovals}
      where ${schema.agentApprovals.runId} = ${schema.agentRuns.id}
        and ${schema.agentApprovals.status} in ('pending', 'approved')
    )`,
  );
  const dropped = sql`exists (
    select 1 from ${schema.agentApprovals}
    where ${schema.agentApprovals.runId} = ${schema.agentRuns.id}
      and ${schema.agentApprovals.status} in ('expired', 'failed')
  )`;

  await context.db
    .update(schema.agentRuns)
    .set({ status: "needs_attention" })
    .where(and(settled, dropped));

  await context.db
    .update(schema.agentRuns)
    .set({ status: "succeeded" })
    .where(and(settled, sql`not ${dropped}`));
}
