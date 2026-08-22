import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * Reads for the AI-employee screens.
 *
 * Every query is scoped by `organizationId` and takes it as an argument
 * rather than resolving the session itself — same convention as
 * `server/support.ts` and `server/crm.ts`, and the reason is that a caller
 * who has already established a session should not be able to accidentally
 * pass a *different* org's id without it being visible at the call site.
 */

export type AgentRow = typeof schema.agents.$inferSelect;

export interface AgentSummary extends AgentRow {
  /** Runs in the last 7 days, so the roster shows who is actually working. */
  recentRuns: number;
  openTasks: number;
  pendingApprovals: number;
  lastSummary: string | null;
  lastRunStatus: string | null;
}

export async function listAgents(organizationId: string): Promise<AgentSummary[]> {
  const agents = await db()
    .select()
    .from(schema.agents)
    .where(
      and(eq(schema.agents.organizationId, organizationId), sql`${schema.agents.status} <> 'archived'`),
    )
    .orderBy(schema.agents.name);
  if (!agents.length) return [];

  const ids = agents.map((a) => a.id);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [runCounts, taskCounts, approvalCounts, lastRuns] = await Promise.all([
    db()
      .select({ agentId: schema.agentRuns.agentId, n: count() })
      .from(schema.agentRuns)
      .where(and(inArray(schema.agentRuns.agentId, ids), gte(schema.agentRuns.createdAt, weekAgo)))
      .groupBy(schema.agentRuns.agentId),
    db()
      .select({ agentId: schema.tasks.assigneeAgentId, n: count() })
      .from(schema.tasks)
      .where(
        and(
          inArray(schema.tasks.assigneeAgentId, ids),
          inArray(schema.tasks.status, ["todo", "in_progress", "blocked", "review"]),
        ),
      )
      .groupBy(schema.tasks.assigneeAgentId),
    db()
      .select({ agentId: schema.agentApprovals.agentId, n: count() })
      .from(schema.agentApprovals)
      .where(
        and(
          inArray(schema.agentApprovals.agentId, ids),
          eq(schema.agentApprovals.status, "pending"),
        ),
      )
      .groupBy(schema.agentApprovals.agentId),
    /**
     * One row per agent via DISTINCT ON, rather than N queries or fetching
     * every run and reducing in JS. The roster is the most-visited agent
     * screen and this keeps it to a fixed four round trips no matter how
     * many agents a workspace hires.
     */
    db()
      .select({
        agentId: schema.agentRuns.agentId,
        summary: schema.agentRuns.summary,
        status: schema.agentRuns.status,
      })
      .from(schema.agentRuns)
      .where(inArray(schema.agentRuns.agentId, ids))
      .orderBy(schema.agentRuns.agentId, desc(schema.agentRuns.createdAt))
      .limit(1000),
  ]);

  const runsBy = new Map(runCounts.map((r) => [r.agentId, r.n]));
  const tasksBy = new Map(taskCounts.map((r) => [r.agentId, r.n]));
  const approvalsBy = new Map(approvalCounts.map((r) => [r.agentId, r.n]));
  const lastBy = new Map<string, { summary: string | null; status: string }>();
  for (const row of lastRuns) {
    if (!lastBy.has(row.agentId)) lastBy.set(row.agentId, { summary: row.summary, status: row.status });
  }

  return agents.map((a) => ({
    ...a,
    recentRuns: runsBy.get(a.id) ?? 0,
    openTasks: tasksBy.get(a.id) ?? 0,
    pendingApprovals: approvalsBy.get(a.id) ?? 0,
    lastSummary: lastBy.get(a.id)?.summary ?? null,
    lastRunStatus: lastBy.get(a.id)?.status ?? null,
  }));
}

export async function getAgent(organizationId: string, agentId: string): Promise<AgentRow | null> {
  const [row] = await db()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listRuns(organizationId: string, agentId: string, limit = 25) {
  return db()
    .select({
      id: schema.agentRuns.id,
      trigger: schema.agentRuns.trigger,
      objective: schema.agentRuns.objective,
      status: schema.agentRuns.status,
      summary: schema.agentRuns.summary,
      error: schema.agentRuns.error,
      stepCount: schema.agentRuns.stepCount,
      costUsd: schema.agentRuns.costUsd,
      promptTokens: schema.agentRuns.promptTokens,
      completionTokens: schema.agentRuns.completionTokens,
      startedAt: schema.agentRuns.startedAt,
      finishedAt: schema.agentRuns.finishedAt,
      createdAt: schema.agentRuns.createdAt,
    })
    .from(schema.agentRuns)
    .where(
      and(eq(schema.agentRuns.organizationId, organizationId), eq(schema.agentRuns.agentId, agentId)),
    )
    .orderBy(desc(schema.agentRuns.createdAt))
    .limit(limit);
}

export async function getRun(organizationId: string, runId: string) {
  const [run] = await db()
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.id, runId), eq(schema.agentRuns.organizationId, organizationId)))
    .limit(1);
  if (!run) return null;

  const [agent] = await db()
    .select({ id: schema.agents.id, name: schema.agents.name, avatar: schema.agents.avatar })
    .from(schema.agents)
    .where(eq(schema.agents.id, run.agentId))
    .limit(1);

  const steps = await db()
    .select()
    .from(schema.agentSteps)
    .where(eq(schema.agentSteps.runId, runId))
    .orderBy(schema.agentSteps.position);

  return { run, agent: agent ?? null, steps };
}

export async function listMemories(agentId: string, limit = 40) {
  return db()
    .select()
    .from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, agentId))
    .orderBy(desc(schema.agentMemories.importance), desc(schema.agentMemories.updatedAt))
    .limit(limit);
}

export interface ApprovalRow {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  runId: string;
  toolName: string;
  title: string;
  rationale: string | null;
  risk: string;
  requiredCapability: string;
  status: string;
  arguments: unknown;
  expiresAt: Date;
  createdAt: Date;
  decidedAt: Date | null;
  error: string | null;
}

export async function listApprovals(
  organizationId: string,
  scope: "pending" | "recent" = "pending",
): Promise<ApprovalRow[]> {
  const rows = await db()
    .select({
      id: schema.agentApprovals.id,
      agentId: schema.agentApprovals.agentId,
      agentName: schema.agents.name,
      agentAvatar: schema.agents.avatar,
      runId: schema.agentApprovals.runId,
      toolName: schema.agentApprovals.toolName,
      title: schema.agentApprovals.title,
      rationale: schema.agentApprovals.rationale,
      risk: schema.agentApprovals.risk,
      requiredCapability: schema.agentApprovals.requiredCapability,
      status: schema.agentApprovals.status,
      arguments: schema.agentApprovals.arguments,
      expiresAt: schema.agentApprovals.expiresAt,
      createdAt: schema.agentApprovals.createdAt,
      decidedAt: schema.agentApprovals.decidedAt,
      error: schema.agentApprovals.error,
    })
    .from(schema.agentApprovals)
    .innerJoin(schema.agents, eq(schema.agentApprovals.agentId, schema.agents.id))
    .where(
      and(
        eq(schema.agentApprovals.organizationId, organizationId),
        scope === "pending"
          ? eq(schema.agentApprovals.status, "pending")
          : sql`${schema.agentApprovals.status} <> 'pending'`,
      ),
    )
    .orderBy(desc(schema.agentApprovals.createdAt))
    .limit(scope === "pending" ? 100 : 40);
  return rows;
}

export async function countPendingApprovals(organizationId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(schema.agentApprovals)
    .where(
      and(
        eq(schema.agentApprovals.organizationId, organizationId),
        eq(schema.agentApprovals.status, "pending"),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Every failure any agent has hit, across every run — one place to look
 * instead of opening each shift's transcript to check.
 *
 * `agent_steps.ok = false` already covers everything worth showing here: a
 * thrown run error (`kind: "error"`), a tool that raised, invalid tool
 * arguments, and a policy refusal all write that row the same way in
 * `run.ts`'s `performCall`. Nothing new needs to be logged — this is the
 * surface that was missing, not the capture.
 */
export interface ErrorLogRow {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  kind: string;
  toolName: string | null;
  message: string;
  objective: string;
  trigger: string;
  createdAt: Date;
}

export async function listErrors(organizationId: string, limit = 200): Promise<ErrorLogRow[]> {
  return db()
    .select({
      id: schema.agentSteps.id,
      runId: schema.agentSteps.runId,
      agentId: schema.agentRuns.agentId,
      agentName: schema.agents.name,
      agentAvatar: schema.agents.avatar,
      kind: schema.agentSteps.kind,
      toolName: schema.agentSteps.toolName,
      // The message lives in different places depending on what failed:
      // `content` for a thrown run error, `result.error` for a tool that
      // raised or was called with bad arguments, `result.refused` for a
      // policy denial.
      message: sql<string>`coalesce(
        ${schema.agentSteps.content},
        ${schema.agentSteps.result} ->> 'error',
        ${schema.agentSteps.result} ->> 'refused',
        'Unknown error'
      )`,
      objective: schema.agentRuns.objective,
      trigger: schema.agentRuns.trigger,
      createdAt: schema.agentSteps.createdAt,
    })
    .from(schema.agentSteps)
    .innerJoin(schema.agentRuns, eq(schema.agentSteps.runId, schema.agentRuns.id))
    .innerJoin(schema.agents, eq(schema.agentRuns.agentId, schema.agents.id))
    .where(
      and(eq(schema.agentRuns.organizationId, organizationId), eq(schema.agentSteps.ok, false)),
    )
    .orderBy(desc(schema.agentSteps.createdAt))
    .limit(limit);
}

/** For the roster banner — same window `listAgents`' recency reads use. */
export async function countRecentErrors(organizationId: string, hours = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const [row] = await db()
    .select({ n: count() })
    .from(schema.agentSteps)
    .innerJoin(schema.agentRuns, eq(schema.agentSteps.runId, schema.agentRuns.id))
    .where(
      and(
        eq(schema.agentRuns.organizationId, organizationId),
        eq(schema.agentSteps.ok, false),
        gte(schema.agentSteps.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

export interface TaskRow {
  id: string;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  assigneeType: string;
  assigneeUserId: string | null;
  assigneeAgentId: string | null;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  creatorType: string;
  creatorAgentName: string | null;
  handoffReason: string | null;
  result: string | null;
  dueAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  relatedType: string | null;
  relatedId: string | null;
}

/**
 * The shared board.
 *
 * Assignee display name comes from a left join against both `user` and
 * `agents`, coalesced — one query, and the board renders a person and an
 * agent identically because at this level of the product they are the same
 * kind of thing: someone who owns a piece of work.
 */
export async function listTasks(
  organizationId: string,
  options: { includeDone?: boolean; limit?: number } = {},
): Promise<TaskRow[]> {
  const rows = await db()
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      body: schema.tasks.body,
      status: schema.tasks.status,
      priority: schema.tasks.priority,
      assigneeType: schema.tasks.assigneeType,
      assigneeUserId: schema.tasks.assigneeUserId,
      assigneeAgentId: schema.tasks.assigneeAgentId,
      assigneeUserName: schema.user.name,
      assigneeAgentName: schema.agents.name,
      assigneeAgentAvatar: schema.agents.avatar,
      creatorType: schema.tasks.creatorType,
      handoffReason: schema.tasks.handoffReason,
      result: schema.tasks.result,
      dueAt: schema.tasks.dueAt,
      createdAt: schema.tasks.createdAt,
      completedAt: schema.tasks.completedAt,
      relatedType: schema.tasks.relatedType,
      relatedId: schema.tasks.relatedId,
      creatorAgentId: schema.tasks.creatorAgentId,
    })
    .from(schema.tasks)
    .leftJoin(schema.user, eq(schema.tasks.assigneeUserId, schema.user.id))
    .leftJoin(schema.agents, eq(schema.tasks.assigneeAgentId, schema.agents.id))
    .where(
      and(
        eq(schema.tasks.organizationId, organizationId),
        options.includeDone
          ? undefined
          : inArray(schema.tasks.status, ["todo", "in_progress", "blocked", "review"]),
      ),
    )
    .orderBy(desc(schema.tasks.createdAt))
    .limit(options.limit ?? 200);

  // Creator names are a second small lookup rather than a third join: most
  // boards have a handful of distinct agents, and the join would need a
  // second alias of the same table for one label.
  const creatorIds = [...new Set(rows.map((r) => r.creatorAgentId).filter(Boolean))] as string[];
  const creators = creatorIds.length
    ? await db()
        .select({ id: schema.agents.id, name: schema.agents.name })
        .from(schema.agents)
        .where(inArray(schema.agents.id, creatorIds))
    : [];
  const creatorNames = new Map(creators.map((c) => [c.id, c.name]));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    status: r.status,
    priority: r.priority,
    assigneeType: r.assigneeType,
    assigneeUserId: r.assigneeUserId,
    assigneeAgentId: r.assigneeAgentId,
    assigneeName: r.assigneeAgentName ?? r.assigneeUserName ?? null,
    assigneeAvatar: r.assigneeAgentAvatar ?? null,
    creatorType: r.creatorType,
    creatorAgentName: r.creatorAgentId ? (creatorNames.get(r.creatorAgentId) ?? null) : null,
    handoffReason: r.handoffReason,
    result: r.result,
    dueAt: r.dueAt,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    relatedType: r.relatedType,
    relatedId: r.relatedId,
  }));
}

export async function getTask(organizationId: string, taskId: string) {
  const [task] = await db()
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.organizationId, organizationId)))
    .limit(1);
  if (!task) return null;

  const comments = await db()
    .select({
      id: schema.taskComments.id,
      authorType: schema.taskComments.authorType,
      body: schema.taskComments.body,
      createdAt: schema.taskComments.createdAt,
      userName: schema.user.name,
      agentName: schema.agents.name,
      agentAvatar: schema.agents.avatar,
    })
    .from(schema.taskComments)
    .leftJoin(schema.user, eq(schema.taskComments.authorUserId, schema.user.id))
    .leftJoin(schema.agents, eq(schema.taskComments.authorAgentId, schema.agents.id))
    .where(eq(schema.taskComments.taskId, taskId))
    .orderBy(schema.taskComments.createdAt);

  return { task, comments };
}

/** Everyone a task can be handed to: the humans and the agents, together. */
export async function listAssignees(organizationId: string) {
  const [people, agents] = await Promise.all([
    db()
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.memberships)
      .innerJoin(schema.user, eq(schema.memberships.userId, schema.user.id))
      .where(eq(schema.memberships.organizationId, organizationId)),
    db()
      .select({
        id: schema.agents.id,
        name: schema.agents.name,
        avatar: schema.agents.avatar,
        roleTitle: schema.agents.roleTitle,
      })
      .from(schema.agents)
      .where(
        and(eq(schema.agents.organizationId, organizationId), eq(schema.agents.status, "active")),
      ),
  ]);
  return { people, agents };
}

/** Work waiting on the signed-in person specifically. */
export async function countMyOpenTasks(organizationId: string, userId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.organizationId, organizationId),
        inArray(schema.tasks.status, ["todo", "in_progress", "blocked", "review"]),
        or(eq(schema.tasks.assigneeUserId, userId), eq(schema.tasks.assigneeType, "unassigned")),
      ),
    );
  return row?.n ?? 0;
}
