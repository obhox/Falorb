import { can, rankOf, type MemberRole } from "@falorb/db";
import type { AgentRecord, Autonomy, ToolDefinition, ToolEffect } from "./types";

/**
 * The single place that decides whether an agent may take an action now, ask
 * a human first, or not at all.
 *
 * Every gate in the product funnels through `decide`. That is worth insisting
 * on: an agent platform's real failure mode is not a model saying something
 * silly, it is a permission check that exists in the UI but not in the worker
 * — or in the worker but not on the path an approval takes when it resumes.
 * One function, called from all three, cannot drift out of agreement with
 * itself.
 *
 * The decision is the conjunction of three independent questions, in order:
 *
 *   1. Does the agent's *role* permit this class of action at all? This is
 *      the identical `can.*` check a human's click passes. It is checked
 *      first and it is absolute — no autonomy setting relaxes it, which is
 *      what makes "give it a viewer role" a meaningful containment even for
 *      an agent someone has set to autonomous.
 *
 *   2. Does the agent's *autonomy* permit acting without asking?
 *
 *   3. Has this specific tool been granted a standing waiver?
 *
 * Note the asymmetry between 1 and 2/3: role can only forbid, autonomy and
 * waivers can only downgrade "ask" to "act". Nothing can upgrade past role.
 */

export type Decision =
  | { kind: "allow" }
  | { kind: "approval"; reason: string }
  | { kind: "deny"; reason: string };

/** What each autonomy level will do without asking. */
const ACTS_FREELY_ON: Record<Autonomy, ToolEffect[]> = {
  observer: ["read"],
  assisted: ["read"],
  autonomous: ["read", "internal"],
};

export function isAutonomy(value: string): value is Autonomy {
  return value === "observer" || value === "assisted" || value === "autonomous";
}

/**
 * An unrecognised autonomy value is treated as the most restrictive one, for
 * the same reason `rankOf` treats an unrecognised role as `viewer`: a value
 * written by a different version of the schema must fail closed. The worst
 * outcome of this default is an agent that asks too often.
 */
export function autonomyOf(agent: Pick<AgentRecord, "autonomy">): Autonomy {
  return isAutonomy(agent.autonomy) ? agent.autonomy : "observer";
}

export function decide(
  agent: Pick<AgentRecord, "role" | "autonomy" | "autoApproveTools">,
  tool: Pick<ToolDefinition, "name" | "capability" | "effect">,
): Decision {
  if (!can[tool.capability](agent.role)) {
    return {
      kind: "deny",
      reason:
        `This agent's role is "${agent.role}", which cannot ${tool.capability}. ` +
        `Hand this to a human, or ask an admin to change the agent's role.`,
    };
  }

  const autonomy = autonomyOf(agent);

  if (autonomy === "observer" && tool.effect !== "read") {
    return {
      kind: "deny",
      reason:
        "This agent is an observer: it can read and report, but cannot change anything. " +
        "Create a task for a human instead, describing exactly what should be done.",
    };
  }

  if (ACTS_FREELY_ON[autonomy].includes(tool.effect)) return { kind: "allow" };

  const waived =
    agent.autoApproveTools.includes("*") || agent.autoApproveTools.includes(tool.name);
  if (waived) return { kind: "allow" };

  return {
    kind: "approval",
    reason:
      tool.effect === "external"
        ? "This reaches a system or a person outside Falorb, so a human decides it."
        : "This agent is assisted, so a human approves each change it makes.",
  };
}

/**
 * Whether `reviewer` may decide an approval that a tool requiring
 * `capability` produced.
 *
 * Approving is exercising: the action runs on the organization's behalf
 * because this person said so. Letting a viewer wave through a contact
 * creation they could not perform themselves would make the approval queue a
 * privilege-escalation route rather than a safety gate — the queue would
 * *be* the hole it was built to close.
 */
export function canDecideApproval(reviewerRole: string, capability: string): boolean {
  if (!can.reviewAgentWork(reviewerRole)) return false;
  const check = can[capability as keyof typeof can];
  return typeof check === "function" ? check(reviewerRole) : false;
}

/**
 * Whether `granterRole` may create or edit an agent holding `agentRole`.
 *
 * `can.manageAgents` is admin-gated, which stops a member from minting an
 * agent at all — but an admin could otherwise create an `owner` agent and
 * then drive it, acquiring owner powers by proxy. An actor cannot delegate
 * authority they do not hold, so the grant is capped at the granter's own
 * rank. This is the agent-shaped twin of `can.assignRole` being owner-only.
 */
export function canGrantAgentRole(granterRole: string, agentRole: MemberRole): boolean {
  if (!can.manageAgents(granterRole)) return false;
  return rankOf(granterRole) >= rankOf(agentRole);
}
