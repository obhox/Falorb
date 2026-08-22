import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolSpec } from "@falorb/ai";
import type { AgentRecord, AnyToolDefinition, Toolkit } from "../types";
import { TOOLKITS } from "../types";
import { analyticsTools } from "./analytics";
import { contentTools } from "./content";
import { crmTools } from "./crm";
import { growthTools } from "./growth";
import { memoryTools } from "./memory";
import { peopleTools } from "./people";
import { prospectingTools } from "./prospecting";
import { supportTools } from "./support";
import { taskTools } from "./tasks";
import { ugcTools } from "./ugc";

/**
 * The catalogue: every action any agent could ever take, and the rules for
 * which agent gets which.
 *
 * One flat registry rather than a per-agent bundle, because two things need
 * to look a tool up by name long after the agent that called it has stopped:
 * a queued approval resuming hours later, and the dashboard rendering what
 * an agent did last week. A tool whose definition only existed inside a
 * particular agent's construction would be unresolvable in both cases.
 */

export const ALL_TOOLS: AnyToolDefinition[] = [
  ...analyticsTools,
  ...peopleTools,
  ...crmTools,
  ...supportTools,
  ...taskTools,
  ...memoryTools,
  ...contentTools,
  ...prospectingTools,
  ...ugcTools,
  ...growthTools,
];

const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

// A duplicate name would mean the model calls one tool and a resumed
// approval executes another. Caught at import, not at 3am.
if (BY_NAME.size !== ALL_TOOLS.length) {
  const seen = new Set<string>();
  const dupes = ALL_TOOLS.map((t) => t.name).filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
  throw new Error(`Duplicate agent tool name(s): ${[...new Set(dupes)].join(", ")}`);
}

export function getTool(name: string): AnyToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function toolsInToolkit(toolkit: Toolkit): AnyToolDefinition[] {
  return ALL_TOOLS.filter((t) => t.toolkit === toolkit);
}

/**
 * The tools one agent may actually call.
 *
 * Filtered by toolkit *and* by role. Handing a `viewer` agent a list
 * containing `crm_create_contact` would mean every run wastes turns trying
 * it and being refused — the policy check would hold, but the agent would
 * look incompetent rather than correctly constrained. Better that it never
 * sees a tool it cannot use.
 *
 * Tools whose approval it would have to wait for *are* included: "ask a
 * human, then continue" is a normal outcome, not a failure, and an assisted
 * agent that could not see any write tool would have nothing to propose.
 */
export function toolsForAgent(
  agent: Pick<AgentRecord, "toolkits" | "role">,
  canDo: (capability: string, role: string) => boolean,
): AnyToolDefinition[] {
  const enabled = new Set(agent.toolkits.filter(isToolkit));
  return ALL_TOOLS.filter((t) => enabled.has(t.toolkit) && canDo(t.capability, agent.role));
}

export function isToolkit(value: string): value is Toolkit {
  return (TOOLKITS as readonly string[]).includes(value);
}

/**
 * Tool definitions in the shape the model reads.
 *
 * `zodToJsonSchema` with `$refStrategy: "none"` matters: OpenAI-compatible
 * function schemas are not reliably resolved when they contain `$ref`s into
 * a `definitions` block, and a shared sub-schema — `projectArg` appears in
 * six tools — is exactly what makes zod emit them. Inlining costs a few
 * bytes per request and removes a class of "the model sent nonsense
 * arguments" bug that is very hard to diagnose from the outside.
 */
export function toSpecs(tools: AnyToolDefinition[]): ToolSpec[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.input, { $refStrategy: "none", target: "openApi3" }) as Record<
      string,
      unknown
    >,
  }));
}
