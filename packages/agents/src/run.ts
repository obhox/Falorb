import type { ClickHouseClient } from "@clickhouse/client";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { chat, stripMarkdown, type ChatMessage, type ToolCall } from "@falorb/ai";
import {
  AUDIT_ACTIONS,
  audit,
  can,
  resolveAiCredentials,
  schema,
  type Database,
} from "@falorb/db";
import { decide } from "./policy";
import { buildSystemPrompt, buildUserPrompt, loadMemories, loadRecentRuns } from "./prompt";
import { getTool, toolsForAgent, toSpecs } from "./tools/index";
import type { AgentContext, AgentProject, AgentRecord, AnyToolDefinition } from "./types";

/**
 * The loop: one shift of work, from objective to written report.
 *
 * The design point that everything else follows from is that **the
 * transcript is in Postgres, not in memory**. Every model turn and every
 * tool result is written to `agent_steps` as it happens, and the
 * conversation handed to the next turn is rebuilt from those rows. That
 * costs a few writes per step and buys three things worth far more: a run
 * survives a worker restart mid-shift, a human can watch a long run
 * progress instead of staring at a spinner, and "what did it actually do"
 * is answerable afterwards without having logged anything separately.
 *
 * How an action that needs permission is handled is the other decision worth
 * stating. The run does **not** block. The tool call returns immediately
 * saying the request is queued, the agent is told (in its briefing) that this
 * is a normal outcome, and it carries on with the rest of the objective. A
 * human decides later and `executeApproval` performs the action — through
 * the same `tool.execute` the agent would have called, never a second copy
 * of the logic. Blocking instead would mean an agent's whole shift is held
 * hostage by one queued email, and a nightly agent would routinely be
 * resumed a day after the numbers it reasoned about were true.
 */

export interface RunDeps {
  db: Database;
  clickhouse: ClickHouseClient;
  /** Narration sink; the worker points this at its logger. */
  onLog?: (runId: string, message: string) => void;
}

export interface RunOutcome {
  status: "succeeded" | "failed" | "waiting_approval";
  summary: string | null;
  steps: number;
  approvalsRaised: number;
}

/** Model turns are the budget unit; each may carry several tool calls. */
const HARD_STEP_CEILING = 40;
const APPROVAL_TTL_HOURS = 72;

export async function executeRun(deps: RunDeps, runId: string): Promise<RunOutcome> {
  const { db } = deps;

  const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)).limit(1);
  if (!run) throw new Error(`No such run: ${runId}`);

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, run.agentId))
    .limit(1);
  if (!agent) throw new Error(`Run ${runId} has no agent.`);

  const log = (message: string) => {
    deps.onLog?.(runId, message);
  };

  const budgetRefusal = await checkBudget(db, agent);
  if (budgetRefusal) {
    await finish(db, runId, "failed", null, budgetRefusal);
    return { status: "failed", summary: null, steps: 0, approvalsRaised: 0 };
  }

  const projects = await loadProjects(db, agent);
  if (!projects.length) {
    const message =
      "This agent has no properties in scope — either the workspace has none, or every " +
      "property it was given has since been archived.";
    await finish(db, runId, "failed", null, message);
    return { status: "failed", summary: null, steps: 0, approvalsRaised: 0 };
  }

  await db
    .update(schema.agentRuns)
    .set({ status: "running", startedAt: run.startedAt ?? new Date(), heartbeatAt: new Date() })
    .where(eq(schema.agentRuns.id, runId));

  const [memories, recentRuns, task, credentials] = await Promise.all([
    loadMemories(db, agent.id),
    loadRecentRuns(db, agent.id),
    loadTask(db, run.taskId),
    // `@falorb/db`'s shared resolver, not a copy: the dashboard, the worker
    // and this runtime must agree on which gateway an org's AI runs against,
    // and two implementations of that eventually disagree. Resolved once per
    // shift rather than per turn — it decrypts a stored key, and a gateway
    // swapped mid-run would bill half a conversation to each.
    resolveAiCredentials(db, agent.organizationId),
  ]);

  const ctx: AgentContext = {
    db,
    clickhouse: deps.clickhouse,
    organizationId: agent.organizationId,
    agent,
    runId,
    projects,
    projectIds: projects.map((p) => p.id),
    credentials,
    log,
  };

  const tools = toolsForAgent(agent, (capability, role) => {
    const check = can[capability as keyof typeof can];
    return typeof check === "function" ? check(role) : false;
  });
  const specs = toSpecs(tools);
  const byName = new Map(tools.map((t) => [t.name, t]));

  const briefing = { agent, projects, objective: run.objective, task, memories, recentRuns };
  const seed: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(briefing) },
    { role: "user", content: buildUserPrompt(briefing) },
  ];

  // Resume support: anything already written for this run is the real
  // transcript, whatever this process remembers.
  const replayed = await replayTranscript(db, runId);
  const messages: ChatMessage[] = [...seed, ...replayed.messages];
  let position = replayed.nextPosition;

  const maxTurns = Math.min(agent.maxStepsPerRun, HARD_STEP_CEILING);
  let promptTokens = run.promptTokens;
  let completionTokens = run.completionTokens;
  let costUsd = Number(run.costUsd);
  let approvalsRaised = 0;
  let summary: string | null = null;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const result = await chat(messages, {
        tools: specs,
        model: agent.model,
        maxTokens: 2000,
        credentials,
      });

      promptTokens += result.usage.promptTokens;
      completionTokens += result.usage.completionTokens;
      costUsd += result.usage.costUsd;

      await writeStep(db, runId, position++, {
        kind: "assistant",
        content: result.content,
        toolCallId: null,
        toolName: null,
        /**
         * The call `id` is persisted, not just the name and arguments.
         *
         * On replay the tool-result rows are turned back into `tool`
         * messages carrying their original `toolCallId`, and every
         * OpenAI-compatible API requires each of those to match an id on a
         * preceding assistant message. Synthesising ids here would
         * guarantee a mismatch — and the first request of every resumed run
         * would be rejected, which is exactly the path a worker crash takes.
         */
        arguments: result.toolCalls.length
          ? {
              toolCalls: result.toolCalls.map((c) => ({
                id: c.id,
                name: c.name,
                args: c.argumentsJson,
              })),
            }
          : null,
        result: null,
        ok: true,
        durationMs: null,
      });

      messages.push({
        role: "assistant",
        content: result.content,
        ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
      });

      if (!result.toolCalls.length) {
        summary = cleanSummary(result.content);
        break;
      }

      for (const call of result.toolCalls) {
        const outcome = await performCall(ctx, byName, call, position);
        position += outcome.stepsWritten;
        if (outcome.raisedApproval) approvalsRaised++;
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: outcome.payload,
        });
      }

      await db
        .update(schema.agentRuns)
        .set({
          heartbeatAt: new Date(),
          stepCount: position,
          promptTokens,
          completionTokens,
          costUsd: costUsd.toFixed(6),
        })
        .where(eq(schema.agentRuns.id, runId));
    }

    /**
     * Out of turns without a closing message: ask once more, tools withheld,
     * so the run ends with a report rather than a truncated tool call.
     *
     * The instruction has to *say* the tools are gone. Withholding them
     * silently is not enough — the first live verification run ended with
     * the model writing its intended tool call out as literal text in the
     * report, markup and all, because it still believed calling one was an
     * option. Naming the constraint, and giving it somewhere to put the
     * intent instead, turns that into a sentence a human can act on.
     */
    if (summary === null) {
      log("Step budget reached — asking for a closing report.");
      messages.push({
        role: "user",
        content:
          "You have used your step budget for this shift. Your tools are no longer available " +
          "— do not attempt to call one, and do not write out a tool call as text. Write your " +
          "report now, in plain prose: what you found, what you did, what is waiting on " +
          "someone else, and what you would look at next. If there was something you intended " +
          "to do and did not get to, say so in a sentence and leave it as a recommendation.",
      });
      const closing = await chat(messages, {
        model: agent.model,
        maxTokens: 1000,
        credentials,
      });
      promptTokens += closing.usage.promptTokens;
      completionTokens += closing.usage.completionTokens;
      costUsd += closing.usage.costUsd;
      summary = cleanSummary(closing.content);
      await writeStep(db, runId, position++, {
        kind: "assistant",
        content: summary,
        toolCallId: null,
        toolName: null,
        arguments: null,
        result: null,
        ok: true,
        durationMs: null,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeStep(db, runId, position++, {
      kind: "error",
      content: message,
      toolCallId: null,
      toolName: null,
      arguments: null,
      result: null,
      ok: false,
      durationMs: null,
    });
    await finish(db, runId, "failed", summary, message, {
      promptTokens,
      completionTokens,
      costUsd,
      stepCount: position,
    });
    return { status: "failed", summary, steps: position, approvalsRaised };
  }

  const status = approvalsRaised > 0 ? "waiting_approval" : "succeeded";
  await finish(db, runId, status, summary, null, {
    promptTokens,
    completionTokens,
    costUsd,
    stepCount: position,
  });

  await db
    .update(schema.agents)
    .set({ lastRunAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.agents.id, agent.id));

  return { status, summary, steps: position, approvalsRaised };
}

/**
 * One tool call: parse, gate, run, record.
 *
 * Every failure mode below returns a *tool result* rather than throwing.
 * That is the whole point — an agent that gets told "those arguments were
 * invalid, here is why" can correct itself, whereas an exception ends the
 * shift over a typo. Only a genuine infrastructure failure should reach the
 * caller's catch.
 */
async function performCall(
  ctx: AgentContext,
  byName: Map<string, AnyToolDefinition>,
  call: ToolCall,
  position: number,
): Promise<{ payload: string; raisedApproval: boolean; stepsWritten: number }> {
  const startedAt = Date.now();
  const tool = byName.get(call.name);

  if (!tool) {
    const payload = refusal(`There is no tool called "${call.name}" available to you.`);
    await writeStep(ctx.db, ctx.runId, position, {
      kind: "tool_result",
      content: null,
      toolName: call.name,
      toolCallId: call.id,
      arguments: null,
      result: { error: payload },
      ok: false,
      durationMs: Date.now() - startedAt,
    });
    return { payload, raisedApproval: false, stepsWritten: 1 };
  }

  let args: unknown;
  try {
    args = tool.input.parse(JSON.parse(call.argumentsJson || "{}"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const payload = refusal(`Those arguments were not valid for ${call.name}: ${detail}`);
    await writeStep(ctx.db, ctx.runId, position, {
      kind: "tool_result",
      content: null,
      toolName: call.name,
      toolCallId: call.id,
      arguments: safeJson(call.argumentsJson),
      result: { error: payload },
      ok: false,
      durationMs: Date.now() - startedAt,
    });
    return { payload, raisedApproval: false, stepsWritten: 1 };
  }

  await writeStep(ctx.db, ctx.runId, position, {
    kind: "tool_call",
    content: tool.summarize(args as never),
    toolName: call.name,
    toolCallId: call.id,
    arguments: args as Record<string, unknown>,
    result: null,
    ok: true,
    durationMs: null,
  });

  const decision = decide(ctx.agent, tool);

  if (decision.kind === "deny") {
    const payload = refusal(decision.reason);
    await writeStep(ctx.db, ctx.runId, position + 1, {
      kind: "tool_result",
      content: null,
      toolName: call.name,
      toolCallId: call.id,
      arguments: null,
      result: { refused: decision.reason },
      ok: false,
      durationMs: Date.now() - startedAt,
    });
    return { payload, raisedApproval: false, stepsWritten: 2 };
  }

  if (decision.kind === "approval") {
    const [approval] = await ctx.db
      .insert(schema.agentApprovals)
      .values({
        organizationId: ctx.organizationId,
        agentId: ctx.agent.id,
        runId: ctx.runId,
        toolName: tool.name,
        toolCallId: call.id,
        arguments: args as Record<string, unknown>,
        title: tool.summarize(args as never),
        rationale: decision.reason,
        risk: tool.risk,
        requiredCapability: tool.capability,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_HOURS * 3_600_000),
      })
      .returning({ id: schema.agentApprovals.id });

    ctx.log(`Awaiting approval: ${tool.summarize(args as never)}`);

    const payload = JSON.stringify({
      status: "awaiting_approval",
      approvalId: approval!.id,
      message:
        "This request is now in a human's approval queue and will be carried out if they " +
        "approve it. This is a normal outcome, not a failure. Do not retry it and do not " +
        "look for another way to achieve the same thing — continue with the rest of your " +
        "objective and mention this in your report.",
    });

    await writeStep(ctx.db, ctx.runId, position + 1, {
      kind: "approval",
      content: tool.summarize(args as never),
      toolName: call.name,
      toolCallId: call.id,
      arguments: null,
      // The whole payload, not just the id: on replay this row becomes the
      // tool message the model sees, and storing only the id would drop the
      // "do not retry, do not route around this" instruction that stops a
      // resumed run from queueing the same approval a second time.
      result: JSON.parse(payload) as Record<string, unknown>,
      ok: true,
      durationMs: Date.now() - startedAt,
    });
    return { payload, raisedApproval: true, stepsWritten: 2 };
  }

  try {
    const result = await tool.execute(ctx, args as never);
    await writeStep(ctx.db, ctx.runId, position + 1, {
      kind: "tool_result",
      content: null,
      toolName: call.name,
      toolCallId: call.id,
      arguments: null,
      result: (result ?? null) as Record<string, unknown> | null,
      ok: true,
      durationMs: Date.now() - startedAt,
    });
    return {
      payload: truncateForModel(JSON.stringify(result ?? null)),
      raisedApproval: false,
      stepsWritten: 2,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const payload = refusal(detail);
    await writeStep(ctx.db, ctx.runId, position + 1, {
      kind: "tool_result",
      content: null,
      toolName: call.name,
      toolCallId: call.id,
      arguments: null,
      result: { error: detail },
      ok: false,
      durationMs: Date.now() - startedAt,
    });
    return { payload, raisedApproval: false, stepsWritten: 2 };
  }
}

/**
 * Carry out an action a human approved.
 *
 * Called by the worker, never by the approver's own request — see the module
 * comment on `agent_approvals`. Rebuilds the agent's context and calls the
 * identical `tool.execute` the run would have, so an approved action and an
 * unapproved one differ only in who decided it.
 */
export async function executeApproval(
  deps: RunDeps,
  approvalId: string,
): Promise<{ ok: boolean; detail: string }> {
  const { db } = deps;
  const [approval] = await db
    .select()
    .from(schema.agentApprovals)
    .where(eq(schema.agentApprovals.id, approvalId))
    .limit(1);
  if (!approval) return { ok: false, detail: "No such approval." };
  if (approval.status !== "approved") {
    return { ok: false, detail: `Approval is "${approval.status}", not approved.` };
  }

  const tool = getTool(approval.toolName);
  if (!tool) {
    await failApproval(db, approvalId, `Tool "${approval.toolName}" no longer exists.`);
    return { ok: false, detail: "Tool no longer exists." };
  }

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, approval.agentId))
    .limit(1);
  if (!agent) {
    await failApproval(db, approvalId, "The agent has been deleted.");
    return { ok: false, detail: "Agent deleted." };
  }

  // Re-check the agent's own role at execution time. An approval sitting in
  // the queue while somebody demoted the agent must not still fire — the
  // human approved this agent taking this action, and it is no longer that
  // agent.
  const check = can[tool.capability as keyof typeof can];
  if (typeof check !== "function" || !check(agent.role)) {
    await failApproval(db, approvalId, `The agent's role ("${agent.role}") no longer permits this.`);
    return { ok: false, detail: "Agent role no longer permits this action." };
  }

  const projects = await loadProjects(db, agent);
  const ctx: AgentContext = {
    db,
    clickhouse: deps.clickhouse,
    organizationId: approval.organizationId,
    agent,
    runId: approval.runId,
    projects,
    projectIds: projects.map((p) => p.id),
    credentials: await resolveAiCredentials(db, approval.organizationId),
    log: (message) => deps.onLog?.(approval.runId, message),
  };

  try {
    const args = tool.input.parse(approval.arguments);
    const result = await tool.execute(ctx, args as never);
    await db
      .update(schema.agentApprovals)
      .set({
        status: "executed",
        executedAt: new Date(),
        result: (result ?? null) as Record<string, unknown> | null,
      })
      .where(eq(schema.agentApprovals.id, approvalId));

    audit(db, {
      organizationId: approval.organizationId,
      actorId: approval.decidedBy,
      actorAgentId: approval.agentId,
      action: AUDIT_ACTIONS.agentActionExecuted,
      targetType: "agent_approval",
      targetId: approvalId,
      metadata: { tool: approval.toolName, title: approval.title },
    });
    return { ok: true, detail: approval.title };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await failApproval(db, approvalId, detail);
    return { ok: false, detail };
  }
}

async function failApproval(db: Database, approvalId: string, error: string): Promise<void> {
  await db
    .update(schema.agentApprovals)
    .set({ status: "failed", error, executedAt: new Date() })
    .where(eq(schema.agentApprovals.id, approvalId));
}

/**
 * Refuse the shift before it starts if the agent is over its daily budget.
 *
 * A rolling 24 hours rather than a calendar day: a limit that resets at
 * midnight lets a looping agent burn the whole allowance again a few hours
 * later, and the point of the cap is the spend rate, not the date.
 */
async function checkBudget(db: Database, agent: AgentRecord): Promise<string | null> {
  const since = new Date(Date.now() - 86_400_000);
  const [row] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${schema.agentRuns.promptTokens} + ${schema.agentRuns.completionTokens}), 0)::int`,
    })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.agentId, agent.id), gte(schema.agentRuns.createdAt, since)));

  // The run being started is already in the table, so it counts itself.
  const runs = (row?.runs ?? 1) - 1;
  if (runs >= agent.dailyRunLimit) {
    return `Daily run limit reached (${agent.dailyRunLimit} runs in the last 24 hours).`;
  }
  if (agent.dailyTokenLimit !== null && (row?.tokens ?? 0) >= agent.dailyTokenLimit) {
    return `Daily token budget reached (${agent.dailyTokenLimit} tokens in the last 24 hours).`;
  }
  return null;
}

async function loadProjects(db: Database, agent: AgentRecord): Promise<AgentProject[]> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.organizationId, agent.organizationId),
        sql`${schema.projects.archivedAt} is null`,
      ),
    );

  const scoped = agent.projectIds.length
    ? rows.filter((r) => agent.projectIds.includes(r.id))
    : rows;

  return scoped.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    timezone: r.timezone,
    domains: r.domains ?? [],
  }));
}

async function loadTask(db: Database, taskId: string | null) {
  if (!taskId) return null;
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) return null;
  const comments = await db
    .select({
      authorType: schema.taskComments.authorType,
      body: schema.taskComments.body,
      createdAt: schema.taskComments.createdAt,
    })
    .from(schema.taskComments)
    .where(eq(schema.taskComments.taskId, taskId))
    .orderBy(schema.taskComments.createdAt);
  return {
    id: task.id,
    title: task.title,
    body: task.body,
    priority: task.priority,
    dueAt: task.dueAt,
    comments,
  };
}

/** The subset of an `agent_steps` row that replay actually reads. */
export interface ReplayableStep {
  position: number;
  kind: string;
  content: string | null;
  toolName: string | null;
  toolCallId: string | null;
  arguments: unknown;
  result: unknown;
}

/**
 * Rebuild the model-facing conversation from what was persisted.
 *
 * Only `assistant` and `tool_result`/`approval` steps become messages —
 * `tool_call` rows are the human-readable record of what was attempted and
 * are already represented inside the assistant message's `toolCalls`.
 * Emitting them again would give the model two copies of every call.
 *
 * Pure and exported so the resume path can be tested without a database.
 * That matters more here than it looks: resume only ever happens after a
 * worker dies mid-shift, so it is the one path that cannot be exercised by
 * running the thing normally — and a mistake in it surfaces at the worst
 * possible moment. The invariant worth guarding is that every `tool`
 * message's `toolCallId` matches an id on a preceding assistant message;
 * without that, an OpenAI-compatible API rejects the request outright.
 */
export function rebuildMessages(steps: ReplayableStep[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  /**
   * Ids declared by the most recent assistant turn and not yet claimed by a
   * result, in order.
   *
   * A row written before ids were persisted has neither an id on the
   * assistant side nor a `toolCallId` on the result side, so both have to be
   * invented — and inventing them independently, from each row's own
   * position, produces two different strings and a transcript the API
   * rejects. Handing the result the next id the assistant actually declared
   * is the only scheme that pairs without either side knowing the other's
   * position, and it is exactly right because results are written in call
   * order within a turn.
   */
  let unclaimed: string[] = [];

  for (const step of steps) {
    if (step.kind === "assistant") {
      const raw = (
        step.arguments as { toolCalls?: { id?: string; name: string; args: string }[] } | null
      )?.toolCalls;
      const toolCalls = (raw ?? []).map((c, i) => ({
        id: c.id ?? `replay_${step.position}_${i}`,
        name: c.name,
        argumentsJson: c.args,
      }));
      unclaimed = toolCalls.map((c) => c.id);
      messages.push({
        role: "assistant",
        content: step.content,
        ...(toolCalls.length ? { toolCalls } : {}),
      });
    } else if (step.kind === "tool_result" || step.kind === "approval") {
      const id = step.toolCallId ?? unclaimed[0] ?? `replay_${step.position}`;
      unclaimed = unclaimed.filter((candidate) => candidate !== id);
      messages.push({
        role: "tool",
        toolCallId: id,
        name: step.toolName ?? "unknown",
        content: truncateForModel(JSON.stringify(step.result ?? null)),
      });
    }
  }
  return messages;
}

async function replayTranscript(
  db: Database,
  runId: string,
): Promise<{ messages: ChatMessage[]; nextPosition: number }> {
  const steps = await db
    .select()
    .from(schema.agentSteps)
    .where(eq(schema.agentSteps.runId, runId))
    .orderBy(schema.agentSteps.position);

  const last = steps.at(-1);
  return {
    messages: rebuildMessages(steps),
    nextPosition: last ? last.position + 1 : 0,
  };
}

interface StepFields {
  kind: string;
  content: string | null;
  toolName: string | null;
  toolCallId: string | null;
  arguments: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  ok: boolean;
  durationMs: number | null;
}

async function writeStep(
  db: Database,
  runId: string,
  position: number,
  fields: StepFields,
): Promise<void> {
  await db.insert(schema.agentSteps).values({
    runId,
    position,
    kind: fields.kind,
    content: fields.content,
    toolName: fields.toolName,
    toolCallId: fields.toolCallId,
    arguments: fields.arguments,
    result: fields.result,
    ok: fields.ok,
    durationMs: fields.durationMs,
  });
}

async function finish(
  db: Database,
  runId: string,
  status: "succeeded" | "failed" | "waiting_approval",
  summary: string | null,
  error: string | null,
  usage?: { promptTokens: number; completionTokens: number; costUsd: number; stepCount: number },
): Promise<void> {
  await db
    .update(schema.agentRuns)
    .set({
      status,
      summary,
      error,
      finishedAt: new Date(),
      heartbeatAt: null,
      ...(usage
        ? {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            costUsd: usage.costUsd.toFixed(6),
            stepCount: usage.stepCount,
          }
        : {}),
    })
    .where(eq(schema.agentRuns.id, runId));
}

/**
 * The report is stored as prose and rendered without a markdown parser, so
 * stray syntax shows up as literal hashes and asterisks on the shift page.
 *
 * The briefing already asks for plain prose. That is not enough on its own,
 * and the first live verification run proved it: the model opened its report
 * with `## Report` and used `**bold**` throughout despite the instruction.
 * `@falorb/ai`'s `stripMarkdown` exists for exactly this — see its own note
 * on why an instruction alone is not reliable here.
 */
function cleanSummary(content: string | null): string | null {
  return content ? stripMarkdown(content) : null;
}

function refusal(message: string): string {
  return JSON.stringify({ status: "refused", message });
}

/**
 * Keep whatever the model sent, even when it is not valid JSON.
 *
 * The step row for a rejected call is the only record of *what* was
 * rejected, and a malformed argument string is exactly the case worth being
 * able to read back — dropping it because it would not parse loses the
 * evidence at the moment it is most useful.
 */
function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
}

/**
 * Tool results go back into the prompt, so an unbounded one is both a cost
 * and a correctness problem: a 50k-character dump crowds out the briefing
 * and the objective. Truncating with an explicit marker tells the model the
 * result was cut rather than letting it reason over a silently partial list.
 */
const MAX_TOOL_RESULT_CHARS = 12_000;

function truncateForModel(payload: string): string {
  if (payload.length <= MAX_TOOL_RESULT_CHARS) return payload;
  return (
    payload.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n…[truncated: ${payload.length - MAX_TOOL_RESULT_CHARS} more characters. Narrow the query — a smaller limit or a filter — if you need the rest.]`
  );
}
