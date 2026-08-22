import type { ClickHouseClient } from "@clickhouse/client";
import type { z } from "zod";
import type { AiCredentials } from "@falorb/ai";
import type { Database, schema } from "@falorb/db";
import type { can } from "@falorb/db";

/**
 * The vocabulary the agent runtime is built out of.
 *
 * The three ideas that everything else follows from:
 *
 *   A **toolkit** is a skillset. Giving an agent the `crm` toolkit is the
 *   same act as telling a new hire "you're on sales" — it is what makes an
 *   agent a sales agent rather than a support one, and it is the only place
 *   that distinction lives. There is no separate "agent type".
 *
 *   A tool's **effect** — read, internal, external — is what the autonomy
 *   dial is graded against, not its name or its toolkit. "Does this reach
 *   outside Falorb and touch someone else's system, or a real person?" is
 *   the question a manager is actually answering when they decide how much
 *   rope to give an agent, so it is the question the type system asks.
 *
 *   A tool's **capability** is a key of `can` in `@falorb/db`'s `roles.ts` —
 *   the identical check a human's click passes. An agent tool that invented
 *   its own permission predicate would be a second answer to "may this actor
 *   do this", which is precisely the drift `roles.ts` exists to prevent.
 */

export const TOOLKITS = [
  "analytics",
  "people",
  "leads",
  "crm",
  "support",
  "tasks",
  "memory",
  "content",
  "prospecting",
  "ugc",
  "growth",
  "email",
] as const;

export type Toolkit = (typeof TOOLKITS)[number];

export const TOOLKIT_LABELS: Record<Toolkit, string> = {
  analytics: "Analytics",
  people: "Visitors & leads",
  leads: "Lead outreach",
  crm: "Sales & CRM",
  support: "Customer support",
  tasks: "Task board",
  memory: "Long-term memory",
  content: "Writing",
  prospecting: "Prospecting",
  ugc: "UGC video",
  growth: "Referrals & signals",
  email: "Own mailbox",
};

export const TOOLKIT_DESCRIPTIONS: Record<Toolkit, string> = {
  analytics: "Traffic, trends, funnels, drop-off and retention across the properties it can see.",
  people: "Individual visitors, their history, and which leads are worth contacting.",
  leads: "Look at one warm lead closely, mark outreach done, and draft the first message.",
  crm: "Read the mirrored CRM, and create or update contacts and signals in Linki.",
  support: "Read conversations and escalations, and resolve an escalation in Bund AI.",
  tasks: "Open, comment on, complete and hand off work on the shared board.",
  memory: "Keep and recall conclusions between shifts.",
  content: "Draft prose — outreach, briefs, summaries — as a step inside a larger job.",
  prospecting: "Review people discovered off-site, qualify them, and draft the approach.",
  ugc: "Generate a UGC video from a brief and queue a finished one for posting.",
  growth: "Referral links, the AI growth-signal cache, and the waitlist queue.",
  email: "Read and send from its own mailbox — a real address a customer can reply to.",
};

/**
 * How far outside itself an action reaches.
 *
 *   read      changes nothing anywhere.
 *   internal  changes Falorb's own data — a task, a note, a status. Fully
 *             reversible by a human looking at the same screen.
 *   external  leaves the building: another product's database, a customer's
 *             inbox, a public feed. Not reliably reversible, and the thing a
 *             manager most wants to be asked about.
 */
export type ToolEffect = "read" | "internal" | "external";

export type ToolRisk = "low" | "medium" | "high";

export type Capability = keyof typeof can;

export type AgentRecord = typeof schema.agents.$inferSelect;

export interface AgentProject {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  domains: string[];
}

/**
 * Everything a tool is allowed to reach.
 *
 * Deliberately narrow. A tool gets the database, ClickHouse, the agent's own
 * row, and the **already-resolved** set of project ids it may touch — it
 * never resolves scope itself. That mirrors `apps/mcp`'s `resolveScope`
 * exactly, and for the same reason: tenancy enforced in one place is
 * enforceable, tenancy enforced in thirty tools is a matter of luck.
 */
export interface AgentContext {
  db: Database;
  clickhouse: ClickHouseClient;
  organizationId: string;
  agent: AgentRecord;
  runId: string;
  /** Every project this agent may read or act on. Never empty at run time —
   * an agent scoped to nothing is refused before the loop starts. */
  projects: AgentProject[];
  projectIds: number[];
  /**
   * The AI gateway this shift is billed to — the organization's own
   * connection, or the deployment key when it has none. Resolved once per
   * run and carried here so a tool that itself calls a model (`draft_text`)
   * spends the same key the shift does, rather than silently falling back
   * to the deployment's.
   */
  credentials: AiCredentials | null;
  /**
   * Tool names a reviewer has waived approval for, for a while — unexpired
   * `agent_approval_grants` rows, loaded once per shift. Read by `decide`
   * next to the agent's permanent `autoApproveTools`.
   */
  activeGrants: string[];
  /** Emitted as the run's narration; surfaced live in the dashboard. */
  log: (message: string) => void;
}

export interface ToolDefinition<TArgs = unknown> {
  name: string;
  toolkit: Toolkit;
  /** Read by the model to decide whether to call this. Written for that
   * reader: what it does, when to reach for it, what it will not do. */
  description: string;
  input: z.ZodType<TArgs>;
  capability: Capability;
  effect: ToolEffect;
  risk: ToolRisk;
  /**
   * One line a human can approve or reject from, without opening the
   * transcript. Takes the parsed arguments so it can name the actual target
   * ("Email hannah@acme.com") rather than the shape of the action.
   */
  summarize: (args: TArgs) => string;
  execute: (ctx: AgentContext, args: TArgs) => Promise<unknown>;
}

/** Widened for storage in the registry, where argument types differ per tool. */
export type AnyToolDefinition = ToolDefinition<never> & {
  input: z.ZodType<unknown>;
  summarize: (args: never) => string;
  execute: (ctx: AgentContext, args: never) => Promise<unknown>;
};

export const AUTONOMY_LEVELS = ["observer", "assisted", "autonomous"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_LABELS: Record<Autonomy, string> = {
  observer: "Observer",
  assisted: "Assisted",
  autonomous: "Autonomous",
};

export const AUTONOMY_DESCRIPTIONS: Record<Autonomy, string> = {
  observer:
    "Reads and thinks. Reports what it finds and opens tasks. Changes nothing, anywhere.",
  assisted:
    "Reads freely. Every change it wants to make waits for you to approve it.",
  autonomous:
    "Works on its own inside Falorb. Anything that reaches a customer or another system still asks you first, unless you have granted that specific action.",
};
