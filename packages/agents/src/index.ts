/**
 * `@falorb/agents` — the AI-employee runtime.
 *
 * Server-only, like `@falorb/ai` and `@falorb/mailer`: it reads decrypted
 * integration credentials and calls out to OpenRouter, so nothing here may
 * ever be reachable from the browser bundle. It is imported by
 * `apps/worker` (which runs shifts) and by `apps/web`'s server actions
 * (which create, brief and supervise agents) — never from a client
 * component.
 */

export { executeRun, executeApproval, haltReason } from "./run";
export type { RunDeps, RunOutcome } from "./run";

export {
  autonomyOf,
  canDecideApproval,
  canGrantAgentRole,
  decide,
  isAutonomy,
} from "./policy";
export type { Decision } from "./policy";

export { AGENT_PRESETS, getPreset } from "./presets";
export type { AgentPreset } from "./presets";

export { ALL_TOOLS, getTool, isToolkit, toolsForAgent, toolsInToolkit, toSpecs } from "./tools/index";

export {
  buildSystemPrompt,
  buildUserPrompt,
  loadDecisionFeedback,
  loadMemories,
  loadRecentRuns,
} from "./prompt";
export type { DecisionFeedback } from "./prompt";

export {
  AUTONOMY_DESCRIPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  TOOLKIT_DESCRIPTIONS,
  TOOLKIT_LABELS,
  TOOLKITS,
} from "./types";
export type {
  AgentContext,
  AgentProject,
  AgentRecord,
  AnyToolDefinition,
  Autonomy,
  Capability,
  ToolDefinition,
  ToolEffect,
  ToolRisk,
  Toolkit,
} from "./types";
