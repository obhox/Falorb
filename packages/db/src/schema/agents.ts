import { type AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { emailAccounts } from "./email";
import { memberRoleEnum, organizations, projects } from "./tenancy";

/**
 * AI employees, and the shared work surface humans and agents both live on.
 *
 * The organising idea, and the reason this is not a bolted-on "AI features"
 * table: **an agent is a workspace member that happens to be software.** It
 * has a name, a job title, a manager-written brief, a role from the same
 * four-value vocabulary a human member has (`memberRoleEnum`), and it works
 * the same task board. Everything it does passes the same capability checks
 * in `roles.ts` that a person's click passes, and lands in the same
 * `audit_log`. There is deliberately no second, parallel permission system
 * for machines — a second interpretation of "may this actor do this" is how
 * one surface quietly permits what the other forbids, which is the exact
 * mistake `roles.ts` was written to stop.
 *
 * Three tables carry the runtime (`agents`, `agent_runs`, `agent_steps`),
 * two carry the collaboration (`tasks`, `task_comments`), one carries the
 * safety gate (`agent_approvals`), and one carries what the agent learns
 * (`agent_memories`).
 *
 * Vocabulary columns are plain `text`, not `pgEnum`, following `ugc.ts` and
 * `prospecting.ts`: these are UI-driven lists that will grow, and a new
 * status should be a new value rather than a migration. The one exception is
 * `agents.role`, which reuses the existing `member_role` enum precisely
 * because it must stay welded to the human one.
 */

/**
 * One AI employee.
 *
 * `instructions` is the manager's brief — who this agent is, what it owns,
 * how it should decide. It is the whole of the persona; there is no hidden
 * second prompt a user cannot see, because an employee whose actual standing
 * orders are invisible to their manager cannot be managed.
 *
 * `autonomy` is the dial that matters:
 *
 *   observer    reads and thinks. Reports findings, opens tasks, comments.
 *               Never writes anywhere else, in Falorb or outside it.
 *   assisted    reads freely; every write produces an approval request a
 *               human decides. The default, and where a new hire starts.
 *   autonomous  writes inside Falorb immediately. Actions that reach the
 *               outside world — sending a message, creating a contact in
 *               Linki, resolving a customer's escalation — still queue for
 *               approval unless that tool is named in `autoApproveTools`.
 *
 * That last clause is the whole safety design in one line. "Autonomous" does
 * not mean "unbounded": promoting an agent to autonomous makes it fast at
 * its own desk, and a named, per-tool grant is what lets it act on someone
 * else's. `autoApproveTools` accepts `"*"` for an operator who genuinely
 * wants no gate at all, so the ceiling is a decision rather than a limit,
 * but it is never the default and never implied.
 *
 * `role` bounds all of this from above regardless of autonomy: a `viewer`
 * agent set to `autonomous` still cannot write, because every tool declares
 * the capability it needs and the check is the same one a human faces.
 */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /** Job title as a human would write it: "Growth analyst", "SDR". */
    roleTitle: text("role_title").notNull(),
    /** A single emoji, stored as text — the roster's stand-in for a face. */
    avatar: text("avatar").notNull().default("🤖"),
    /**
     * The agent's own mailbox — a Migadu-provisioned `email_accounts` row
     * it alone sends from. An agent with one has a real address a customer
     * can reply to, and the `email` toolkit's `send_email` refuses to send
     * from anything else: it is *its* mailbox the way a person's is theirs,
     * not a pool it picks from. Null until a manager provisions one (at hire,
     * or later from the agent's page); `set null` rather than cascade so
     * archiving a mailbox leaves the agent standing.
     */
    emailAccountId: uuid("email_account_id").references(() => emailAccounts.id, { onDelete: "set null" }),

    /** Preset key from `@falorb/agents`' roster, or "custom". Kept for
     * provenance: it explains where the starting instructions came from
     * after a user has edited them beyond recognition. */
    preset: text("preset").notNull().default("custom"),

    /** The manager's brief. Becomes the system prompt, verbatim, wrapped in
     * the platform's own operating rules. */
    instructions: text("instructions").notNull(),

    /** Permission tier — the same vocabulary and meaning as a human member. */
    role: memberRoleEnum("role").notNull().default("viewer"),
    /** "observer" | "assisted" | "autonomous". */
    autonomy: text("autonomy").notNull().default("assisted"),

    /** Tool packs this agent may use: "analytics", "people", "crm",
     * "support", "social", "content", "tasks", "memory", "research".
     * Empty means no tools at all, which is a usable state for an agent that
     * only writes reports from the context it is handed. */
    toolkits: text("toolkits").array().notNull().default([]),
    /** Tools whose approval gate is waived for this agent. An entry is
     * either an exact tool name, `toolkit:<name>` to waive every tool in one
     * skillset (e.g. `toolkit:crm`), or `"*"` to waive every gate. Never
     * populated by default — see the module note. */
    autoApproveTools: text("auto_approve_tools").array().notNull().default([]),

    /** Properties this agent may touch. Empty means every project in the
     * organization, which is the common case for a portfolio-wide role and
     * the reason this is not a join table. */
    projectIds: integer("project_ids").array().notNull().default([]),

    /**
     * Per-agent OpenRouter model override. Null — the default, and the
     * intended setting — falls through to `OPENROUTER_MODEL`, itself
     * normally blank, which means `openrouter/auto`: OpenRouter picks per
     * request. Tool support is guaranteed by `provider.require_parameters`
     * rather than by pinning (see `chat()` in `@falorb/ai`), so there is no
     * reason to name a model here unless one specifically misbehaves.
     */
    model: text("model"),

    /** "active" | "paused" | "archived". A paused agent keeps its history
     * and its assignments but is skipped by the scheduler. */
    status: text("status").notNull().default("active"),

    /**
     * The shift. `scheduleMinutes` null means the agent has no standing
     * rounds and only ever runs when something asks it to — a task landing
     * in its queue, an alert firing, a human pressing run.
     *
     * `nextRunAt` is a stored watermark rather than a computed
     * `lastRunAt + interval` so that pausing, editing the interval, or
     * running manually all move the next round in the obvious way.
     */
    scheduleMinutes: integer("schedule_minutes"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),

    /** Standing objective for a scheduled round: what to do each shift when
     * nothing specific has been assigned. */
    scheduleObjective: text("schedule_objective"),

    /**
     * Budget. A runaway loop is the failure mode of every agent system, so
     * the ceiling is data rather than a constant someone forgot to change.
     *
     * Counts **model turns**, not `agent_steps` rows — one turn writes an
     * assistant row plus two rows per tool call it makes, so a run's
     * `stepCount` is routinely several times this number. The UI says
     * "turns" for that reason; a budget and a transcript length that both
     * called themselves "steps" would read as a broken limit.
     */
    maxStepsPerRun: integer("max_steps_per_run").notNull().default(12),
    dailyRunLimit: integer("daily_run_limit").notNull().default(24),
    /** Combined prompt+completion tokens per rolling day; null = uncapped. */
    dailyTokenLimit: integer("daily_token_limit"),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agents_org_idx").on(t.organizationId),
    index("agents_org_status_idx").on(t.organizationId, t.status),
    /** The scheduler's only query: due, active, anywhere. */
    index("agents_due_idx").on(t.status, t.nextRunAt),
    unique("agents_org_name_unique").on(t.organizationId, t.name),
  ],
);

/**
 * One execution: the agent woke up, was given an objective, and worked until
 * it finished, ran out of budget, or hit something it needed a human for.
 *
 * A run is the unit a person reviews. It carries the final written summary
 * because that is what a manager actually reads — the step log underneath is
 * for when they want to know how it got there.
 *
 * `waiting_approval` is a completed shift that left something undecided, not
 * an error and not a pause: the agent proposed one or more actions a human
 * must sign off, was told so mid-run, and carried on with the rest of the
 * objective. The run itself is finished. Blocking instead would hold a whole
 * shift hostage to one queued email, and would leave a nightly agent resumed
 * a day after the numbers it reasoned about stopped being true.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    /** "schedule" | "manual" | "task" | "alert" | "delegation". */
    trigger: text("trigger").notNull(),
    /** Free-form id of whatever triggered it, for tracing back. */
    triggerRef: text("trigger_ref"),
    /** Forward reference: `tasks` is declared below, and the callback keeps
     * the lookup lazy. */
    taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),

    /** What this run was asked to do, in words. */
    objective: text("objective").notNull(),

    /** "queued" | "running" | "waiting_approval" | "succeeded" | "failed"
     * | "cancelled". */
    status: text("status").notNull().default("queued"),
    /** The agent's own closing report. */
    summary: text("summary"),
    error: text("error"),

    stepCount: integer("step_count").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    /** Reported by OpenRouter when available; best-effort, not billing. */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),

    /** Set while a worker holds this run, cleared when it lets go. A run
     * whose heartbeat has gone stale is reclaimable — same reasoning as
     * `ugcVideos.processingStartedAt`: a crashed worker must not strand
     * work forever. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),

    /** Null for scheduled and delegated runs; set when a person pressed run. */
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_org_created_idx").on(t.organizationId, t.createdAt),
    index("agent_runs_agent_created_idx").on(t.agentId, t.createdAt),
    /** The worker's claim query. */
    index("agent_runs_status_idx").on(t.status, t.createdAt),
    index("agent_runs_task_idx").on(t.taskId),
  ],
);

/**
 * Append-only trace of a run: every model turn, every tool call, every
 * result.
 *
 * This is the transcript, and it is the reason an autonomous agent is
 * something a business can actually run on. "The agent updated a deal" is
 * not reviewable; "at step 4 it called `crm_update_contact` with these
 * arguments and got this back" is. Steps are also how a paused run resumes —
 * the conversation is rebuilt from here rather than held in worker memory,
 * so a restart mid-run loses nothing.
 */
export const agentSteps = pgTable(
  "agent_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    /** Position in the transcript, from 0. */
    position: integer("position").notNull(),

    /** "assistant" | "tool_call" | "tool_result" | "approval" | "error". */
    kind: text("kind").notNull(),
    /** The model's prose for an "assistant" step. */
    content: text("content"),

    toolName: text("tool_name"),
    /** The model's own id for the call, needed to pair result to call when
     * the transcript is replayed back to the model. */
    toolCallId: text("tool_call_id"),
    arguments: jsonb("arguments"),
    result: jsonb("result"),
    ok: boolean("ok"),

    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("agent_steps_run_position_unique").on(t.runId, t.position),
    index("agent_steps_run_idx").on(t.runId, t.position),
  ],
);

/**
 * The shared work board. One table for human work and agent work, because
 * the entire premise is that they are the same work.
 *
 * Both directions run through here. A human assigns a task to an agent by
 * setting `assigneeAgentId`, which the worker picks up as a run. An agent
 * hands work to a human by creating a row with `assigneeType: "human"` and a
 * `handoffReason` — which is what happens whenever it hits something it
 * cannot do: a capability its role denies, a credential it does not hold, a
 * judgement call it should not be making, or a real-world action (a phone
 * call, a signature) that no software can take.
 *
 * `assigneeType` is stored rather than derived from which id is non-null so
 * that "assigned to a person, not yet to a specific person" is expressible.
 * A task nobody owns is the normal state of an inbox.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),

    title: text("title").notNull(),
    body: text("body"),

    /** "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled". */
    status: text("status").notNull().default("todo"),
    /** "low" | "normal" | "high" | "urgent". */
    priority: text("priority").notNull().default("normal"),

    /** "human" | "agent" | "unassigned". */
    assigneeType: text("assignee_type").notNull().default("unassigned"),
    assigneeUserId: text("assignee_user_id").references(() => user.id, { onDelete: "set null" }),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),

    /** "human" | "agent" | "system". */
    creatorType: text("creator_type").notNull().default("human"),
    creatorUserId: text("creator_user_id").references(() => user.id, { onDelete: "set null" }),
    creatorAgentId: uuid("creator_agent_id").references(() => agents.id, { onDelete: "set null" }),

    /** Why an agent could not do this itself. Null on human-authored tasks.
     * Worth its own column rather than a line in `body`: it is the single
     * most useful thing to see on a handoff, and it is what tells a manager
     * their agent is under-permissioned rather than incapable. */
    handoffReason: text("handoff_reason"),

    /** What the assignee did, written on completion. */
    result: text("result"),

    dueAt: timestamp("due_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** Subtasks. An agent breaking a brief into steps, or a human splitting
     * one out to delegate — the same shape either way. */
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "cascade",
    }),
    /** How many agent-to-agent hops produced this task: 0 for anything a
     * human created or an agent opened on its own initiative, incrementing
     * by one each time `delegate_task` hands it from one agent to another.
     * The bound `@falorb/agents`' `MAX_DELEGATION_DEPTH` enforces against —
     * a delegation loop between autonomous agents is the one failure mode
     * here with no natural end, and a monotonically increasing counter caps
     * it regardless of the loop's shape (chain or ping-pong) without needing
     * cycle detection. */
    delegationDepth: integer("delegation_depth").notNull().default(0),
    /** Loose pointer at whatever this concerns: "person" | "contact" |
     * "escalation" | "project" | "deal" | "prospect". Deliberately not a
     * foreign key — the referent lives across three schemas and two
     * databases. */
    relatedType: text("related_type"),
    relatedId: text("related_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_org_status_idx").on(t.organizationId, t.status),
    index("tasks_assignee_user_idx").on(t.assigneeUserId, t.status),
    /** The worker's pickup query: work waiting on a given agent. */
    index("tasks_assignee_agent_idx").on(t.assigneeAgentId, t.status),
    index("tasks_org_created_idx").on(t.organizationId, t.createdAt),
    index("tasks_parent_idx").on(t.parentTaskId),
  ],
);

/**
 * The conversation on a task — the place a human and an agent actually talk.
 *
 * An agent reads the whole thread when it picks the task up, so a comment is
 * how you redirect one mid-flight without editing its brief. `authorType`
 * distinguishes the three voices; "system" covers status transitions worth
 * narrating, so the thread reads as a complete history rather than needing a
 * separate activity feed beside it.
 */
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** "human" | "agent" | "system". */
    authorType: text("author_type").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId, t.createdAt)],
);

/**
 * An action an agent wants to take, waiting on a person.
 *
 * The row is written the moment the model asks for the tool call; the agent
 * is told the request is queued and continues its shift. Nothing is executed
 * by the approver's own request either — the worker picks up the decision
 * and calls `tool.execute` exactly as the agent would have, so there is one
 * execution path whether or not a gate was crossed. Two implementations of
 * "perform this action" would eventually disagree about scoping, and the
 * approved path is the worst possible place for that to happen.
 *
 * The agent's role is re-checked at execution time, not only when the row
 * was written: an approval sitting in the queue while somebody demoted the
 * agent must not still fire, because the human approved *that agent* taking
 * this action and it is no longer that agent.
 *
 * `requiredCapability` is denormalised from the tool definition so the
 * reviewer's own role can be checked against it at decision time: approving
 * an action is exercising it, and a viewer must not be able to authorise a
 * write they could not perform themselves.
 *
 * `expiresAt` exists because a stale approval is dangerous in a way a stale
 * task is not — "send this follow-up" agreed to on Monday should not fire on
 * Friday against numbers nobody has re-read.
 */
export const agentApprovals = pgTable(
  "agent_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),

    toolName: text("tool_name").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    arguments: jsonb("arguments").notNull().default({}),

    /** One line a reviewer can decide from without reading the transcript. */
    title: text("title").notNull(),
    /** The agent's stated reason, in its own words. */
    rationale: text("rationale"),
    /** "low" | "medium" | "high" — from the tool's declared risk. */
    risk: text("risk").notNull().default("medium"),
    /** Key of `can` in roles.ts that the reviewer must also hold. */
    requiredCapability: text("required_capability").notNull(),

    /** "pending" | "approved" | "rejected" | "expired" | "executed"
     * | "failed". `approved` is the brief window between a decision and the
     * worker carrying it out; `executed` means it actually happened. */
    status: text("status").notNull().default("pending"),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** A rejection reason is fed back to the agent as the tool result, so it
     * can adapt rather than simply retry. */
    decisionNote: text("decision_note"),

    result: jsonb("result"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    error: text("error"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_approvals_org_status_idx").on(t.organizationId, t.status),
    index("agent_approvals_run_idx").on(t.runId),
    index("agent_approvals_agent_idx").on(t.agentId, t.createdAt),
  ],
);

/**
 * What an agent has learned and should still know next week.
 *
 * A run's transcript dies with the run. Without somewhere durable to put a
 * conclusion, an agent re-derives the same findings every shift and never
 * accumulates judgement — which is the difference between a scheduled script
 * and an employee. Memories are written by the agent itself through a tool,
 * and are plain text on purpose: they are read back into the prompt, and a
 * structure the model has to serialise into is a structure it will fight.
 *
 * Scoped per agent, not per organization: two agents holding contradictory
 * beliefs is normal and legible, whereas a shared pool would let one
 * agent's mistaken conclusion silently steer another's work.
 */
export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    /** Short slug the agent chooses, and the handle it recalls by. */
    key: text("key").notNull(),
    /** "fact" | "preference" | "playbook" | "contact" | "outcome". */
    scope: text("scope").notNull().default("fact"),
    content: text("content").notNull(),
    /** 1–5. Only the most important survive the prompt's memory budget. */
    importance: integer("importance").notNull().default(3),

    sourceRunId: uuid("source_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("agent_memories_agent_key_unique").on(t.agentId, t.key),
    index("agent_memories_agent_idx").on(t.agentId, t.importance),
  ],
);
