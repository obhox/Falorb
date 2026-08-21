import "server-only";
import { can } from "@falorb/db";
import type { ActionResult } from "./project";

/**
 * Role checks for server actions.
 *
 * Server actions are public endpoints. Next generates an id for each one and
 * anything that can post to that id can invoke it, so a control hidden in the
 * UI is not an authorization decision — it is a hint. Every mutation therefore
 * re-derives the caller's role from their session and refuses here.
 *
 * The refusals name the role required rather than saying "forbidden", because
 * the reader is a colleague who needs to know who to ask, not an attacker
 * being stonewalled.
 */

type Capability = keyof typeof can;

const REQUIREMENT: Record<Capability, string> = {
  read: "be a member of this workspace",
  writeAnalysis: "be a member or above",
  manageProject: "be an owner or admin",
  share: "be an owner or admin",
  manageTeam: "be an owner or admin",
  assignRole: "be an owner",
  archiveProject: "be an owner",
  actOnIntegrations: "be a member or above",
  manageIntegrations: "be an owner or admin",
  manageCrm: "be a member or above",
  manageUgcVideos: "be a member or above",
  manageAgents: "be an owner or admin",
  runAgents: "be a member or above",
  manageTasks: "be a member or above",
  reviewAgentWork: "be a member or above",
};

/** Returns null when permitted, or the failure to hand straight back. */
export function deny(role: string, capability: Capability, action: string): ActionResult | null {
  if (can[capability](role)) return null;
  return { ok: false, message: `You need to ${REQUIREMENT[capability]} to ${action}.` };
}
