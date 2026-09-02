"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import {
  AGENT_PRESETS,
  canDecideApproval,
  canGrantAgentRole,
  getPreset,
  isAutonomy,
  isToolkit,
} from "@falorb/agents";
import { AUDIT_ACTIONS, audit, db, isMemberRole, schema, type MemberRole } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Managing the AI employees.
 *
 * The important checks are not the obvious ones. `can.manageAgents` being
 * admin-gated stops a member creating an agent at all — but the two rules
 * that actually close the escalation routes are:
 *
 *   An agent cannot be granted a role above the granter's own
 *   (`canGrantAgentRole`). Otherwise an admin creates an `owner` agent,
 *   assigns it a task, and has owner powers by proxy.
 *
 *   An approval can only be decided by someone who could have performed the
 *   action themselves (`canDecideApproval`). Otherwise the approval queue —
 *   the safety feature — becomes the route by which a viewer gets writes
 *   performed on their say-so.
 *
 * Both live in `@falorb/agents`' policy module so the worker enforces the
 * identical rule when it executes a decision, rather than trusting that this
 * file already did.
 */

const MAX_INSTRUCTIONS = 8000;

function parseToolkits(formData: FormData): string[] {
  return formData.getAll("toolkits").map(String).filter(isToolkit);
}

function parseProjectIds(formData: FormData, allowed: number[]): number[] {
  const raw = formData.getAll("projectIds").map((v) => Number(String(v)));
  return raw.filter((id) => Number.isInteger(id) && allowed.includes(id));
}

export async function hireAgentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageAgents", "hire an agent");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;

  const presetKey = String(formData.get("preset") ?? "custom");
  const preset = getPreset(presetKey);

  const name = String(formData.get("name") ?? "").trim() || preset?.name || "";
  if (!name || name.length > 60) {
    return { ok: false, message: "Give the agent a name of 1–60 characters." };
  }

  const roleTitle = String(formData.get("roleTitle") ?? "").trim() || preset?.roleTitle || "";
  if (!roleTitle) return { ok: false, message: "Give the agent a job title." };

  const instructions = (
    String(formData.get("instructions") ?? "").trim() ||
    preset?.instructions ||
    ""
  ).trim();
  if (instructions.length < 20) {
    return {
      ok: false,
      message: "Write a brief of at least 20 characters — it is the agent's whole job description.",
    };
  }
  if (instructions.length > MAX_INSTRUCTIONS) {
    return { ok: false, message: `Keep the brief under ${MAX_INSTRUCTIONS} characters.` };
  }

  const roleRaw = String(formData.get("role") ?? preset?.role ?? "viewer");
  if (!isMemberRole(roleRaw)) return { ok: false, message: "Choose a valid permission level." };
  if (!canGrantAgentRole(session.workspace.role, roleRaw)) {
    return {
      ok: false,
      message: `You cannot give an agent the "${roleRaw}" role — you do not hold it yourself.`,
    };
  }

  const autonomy = String(formData.get("autonomy") ?? preset?.autonomy ?? "assisted");
  if (!isAutonomy(autonomy)) return { ok: false, message: "Choose a valid autonomy level." };

  const toolkits = parseToolkits(formData);
  const usePresetToolkits = toolkits.length === 0 && preset;
  const projectIds = parseProjectIds(
    formData,
    session.projects.map((p) => p.id),
  );

  const scheduleRaw = String(formData.get("scheduleMinutes") ?? "").trim();
  const scheduleMinutes = scheduleRaw ? Number(scheduleRaw) : (preset?.scheduleMinutes ?? null);
  if (scheduleMinutes !== null && (!Number.isInteger(scheduleMinutes) || scheduleMinutes < 15)) {
    return { ok: false, message: "A shift interval must be at least 15 minutes." };
  }

  const [existing] = await db()
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(and(eq(schema.agents.organizationId, orgId), eq(schema.agents.name, name)))
    .limit(1);
  if (existing) return { ok: false, message: `You already have an agent called ${name}.` };

  const [created] = await db()
    .insert(schema.agents)
    .values({
      organizationId: orgId,
      name,
      roleTitle,
      avatar: String(formData.get("avatar") ?? "").trim() || preset?.avatar || "🤖",
      preset: preset?.key ?? "custom",
      instructions,
      role: roleRaw,
      autonomy,
      toolkits: usePresetToolkits ? preset.toolkits : toolkits,
      projectIds,
      scheduleMinutes,
      scheduleObjective:
        String(formData.get("scheduleObjective") ?? "").trim() || preset?.scheduleObjective || null,
      // A brand-new agent starts its first shift on its own schedule rather
      // than immediately: hiring someone should not instantly spend money
      // before the person who hired them has read the brief back.
      nextRunAt: scheduleMinutes ? new Date(Date.now() + scheduleMinutes * 60_000) : null,
      createdBy: session.user.id,
    })
    .returning({ id: schema.agents.id });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.agentCreated,
    targetType: "agent",
    targetId: created!.id,
    metadata: { name, role: roleRaw, autonomy, preset: preset?.key ?? "custom" },
  });

  revalidatePath("/agents");
  return { ok: true, message: `${name} hired.` };
}

export async function updateAgentAction(
  agentId: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageAgents", "change an agent");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [agent] = await db()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.organizationId, orgId)))
    .limit(1);
  if (!agent) return { ok: false, message: "No such agent." };

  const patch: Partial<typeof schema.agents.$inferInsert> = { updatedAt: new Date() };

  if (formData.has("instructions")) {
    const instructions = String(formData.get("instructions") ?? "").trim();
    if (instructions.length < 20) {
      return { ok: false, message: "The brief is too short to be useful." };
    }
    if (instructions.length > MAX_INSTRUCTIONS) {
      return { ok: false, message: `Keep the brief under ${MAX_INSTRUCTIONS} characters.` };
    }
    patch.instructions = instructions;
  }

  if (formData.has("roleTitle")) {
    const roleTitle = String(formData.get("roleTitle") ?? "").trim();
    if (!roleTitle) return { ok: false, message: "Give the agent a job title." };
    patch.roleTitle = roleTitle;
  }

  let roleChanged: MemberRole | null = null;
  if (formData.has("role")) {
    const roleRaw = String(formData.get("role") ?? "");
    if (!isMemberRole(roleRaw)) return { ok: false, message: "Choose a valid permission level." };
    if (!canGrantAgentRole(session.workspace.role, roleRaw)) {
      return {
        ok: false,
        message: `You cannot give an agent the "${roleRaw}" role — you do not hold it yourself.`,
      };
    }
    patch.role = roleRaw;
    if (roleRaw !== agent.role) roleChanged = roleRaw;
  }

  let autonomyChanged: string | null = null;
  if (formData.has("autonomy")) {
    const autonomy = String(formData.get("autonomy") ?? "");
    if (!isAutonomy(autonomy)) return { ok: false, message: "Choose a valid autonomy level." };
    patch.autonomy = autonomy;
    if (autonomy !== agent.autonomy) autonomyChanged = autonomy;
  }

  if (formData.has("toolkits")) patch.toolkits = parseToolkits(formData);
  if (formData.has("projectIds")) {
    patch.projectIds = parseProjectIds(
      formData,
      session.projects.map((p) => p.id),
    );
  }

  if (formData.has("scheduleMinutes")) {
    const raw = String(formData.get("scheduleMinutes") ?? "").trim();
    if (!raw) {
      patch.scheduleMinutes = null;
      patch.nextRunAt = null;
    } else {
      const minutes = Number(raw);
      if (!Number.isInteger(minutes) || minutes < 15) {
        return { ok: false, message: "A shift interval must be at least 15 minutes." };
      }
      patch.scheduleMinutes = minutes;
      patch.nextRunAt = new Date(Date.now() + minutes * 60_000);
    }
  }

  if (formData.has("scheduleObjective")) {
    patch.scheduleObjective = String(formData.get("scheduleObjective") ?? "").trim() || null;
  }

  if (formData.has("maxStepsPerRun")) {
    const steps = Number(String(formData.get("maxStepsPerRun") ?? ""));
    if (!Number.isInteger(steps) || steps < 1 || steps > 40) {
      return { ok: false, message: "Turns per shift must be between 1 and 40." };
    }
    patch.maxStepsPerRun = steps;
  }

  if (formData.has("dailyRunLimit")) {
    const runs = Number(String(formData.get("dailyRunLimit") ?? ""));
    if (!Number.isInteger(runs) || runs < 1 || runs > 200) {
      return { ok: false, message: "Shifts per day must be between 1 and 200." };
    }
    patch.dailyRunLimit = runs;
  }

  /**
   * Two tiers of auto-approval, and they compose by precedence rather than
   * union: blanket (`"*"`) waives every gate and is owner-only, since the
   * person switching off the entire safety model should be the person who
   * carries the consequences. A per-toolkit waiver (`toolkit:<name>`) is
   * strictly narrower — "trust this agent's CRM writes" rather than "trust
   * it entirely" — so it stays at the same admin tier as the rest of agent
   * management (`can.manageAgents`, already checked above). When both are
   * submitted, blanket wins: the toolkit checkboxes are disabled in the UI
   * whenever "unattended" is on, so this only matters if a client sends both
   * anyway.
   */
  let nextAutoApproveTools: string[] | undefined;
  if (formData.has("autoApproveAll")) {
    const wantsAll = String(formData.get("autoApproveAll")) === "on";
    if (wantsAll && session.workspace.role !== "owner") {
      return { ok: false, message: "Only an owner can let an agent act without any approvals." };
    }
    nextAutoApproveTools = wantsAll ? ["*"] : [];
  }
  if (formData.has("autoApproveToolkits") && nextAutoApproveTools?.[0] !== "*") {
    nextAutoApproveTools = formData
      .getAll("autoApproveToolkits")
      .map(String)
      .filter(isToolkit)
      .map((t) => `toolkit:${t}`);
  }
  if (nextAutoApproveTools) patch.autoApproveTools = nextAutoApproveTools;

  await db().update(schema.agents).set(patch).where(eq(schema.agents.id, agentId));

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: roleChanged
      ? AUDIT_ACTIONS.agentRoleChanged
      : autonomyChanged
        ? AUDIT_ACTIONS.agentAutonomyChanged
        : AUDIT_ACTIONS.agentUpdated,
    targetType: "agent",
    targetId: agentId,
    metadata: {
      name: agent.name,
      ...(roleChanged ? { from: agent.role, to: roleChanged } : {}),
      ...(autonomyChanged ? { autonomyFrom: agent.autonomy, autonomyTo: autonomyChanged } : {}),
      ...(patch.autoApproveTools ? { autoApproveTools: patch.autoApproveTools } : {}),
    },
  });

  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");
  return { ok: true, message: "Saved." };
}

export async function setAgentStatusAction(
  agentId: string,
  status: "active" | "paused",
): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageAgents", "pause or resume an agent");
  if (refusal) return refusal;

  const updated = await db()
    .update(schema.agents)
    .set({
      status,
      updatedAt: new Date(),
      // Resuming schedules the next shift a minute out rather than
      // retroactively, so un-pausing never fires a burst of catch-up runs.
      ...(status === "active" ? { nextRunAt: new Date(Date.now() + 60_000) } : { nextRunAt: null }),
    })
    .where(
      and(
        eq(schema.agents.id, agentId),
        eq(schema.agents.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ name: schema.agents.name });
  if (!updated.length) return { ok: false, message: "No such agent." };

  revalidatePath("/agents");
  revalidatePath(`/agents/${agentId}`);
  return { ok: true, message: status === "paused" ? "Paused." : "Back on shift." };
}

export async function retireAgentAction(agentId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageAgents", "retire an agent");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [agent] = await db()
    .select({ name: schema.agents.name })
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.organizationId, orgId)))
    .limit(1);
  if (!agent) return { ok: false, message: "No such agent." };

  /**
   * Archive, never delete.
   *
   * Its runs, its approvals and everything it did are audit history, and
   * deleting the row would take the agent's name off every past action with
   * it — "who changed this deal" would start answering "nobody". Tasks it
   * created stay on the board, because they are still work somebody has to
   * do.
   */
  await db()
    .update(schema.agents)
    .set({ status: "archived", nextRunAt: null, updatedAt: new Date() })
    .where(eq(schema.agents.id, agentId));

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.agentDeleted,
    targetType: "agent",
    targetId: agentId,
    metadata: { name: agent.name },
  });

  revalidatePath("/agents");
  return { ok: true, message: `${agent.name} has been retired.` };
}

export async function runAgentNowAction(
  agentId: string,
  objective?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "runAgents", "start an agent's shift");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [agent] = await db()
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, agentId), eq(schema.agents.organizationId, orgId)))
    .limit(1);
  if (!agent) return { ok: false, message: "No such agent." };
  if (agent.status !== "active") return { ok: false, message: `${agent.name} is paused.` };

  const [run] = await db()
    .insert(schema.agentRuns)
    .values({
      organizationId: orgId,
      agentId,
      trigger: "manual",
      objective:
        objective?.trim() ||
        agent.scheduleObjective?.trim() ||
        "Do your regular round: review what has changed in your area, and act on anything that needs it.",
      startedBy: session.user.id,
    })
    .returning({ id: schema.agentRuns.id });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.agentRunStarted,
    targetType: "agent",
    targetId: agentId,
    metadata: { runId: run!.id, trigger: "manual" },
  });

  revalidatePath(`/agents/${agentId}`);
  return {
    ok: true,
    message: `${agent.name} is queued — the shift starts within a couple of minutes.`,
  };
}

export async function decideApprovalAction(
  approvalId: string,
  decision: "approve" | "reject",
  note?: string,
  /** Also waive approval for this tool on this agent, for this many days. */
  grantDays?: number,
): Promise<ActionResult> {
  const result = await decideApprovalsAction([approvalId], decision, note, grantDays);
  if (!result.ok) return result;
  return {
    ok: true,
    message:
      decision === "approve"
        ? grantDays
          ? `Approved — and ${grantDays === 1 ? "for a day" : `for ${grantDays} days`} this agent won't ask again about this action.`
          : "Approved — it will be carried out within a minute."
        : "Rejected. The agent will be told, and will not retry it.",
  };
}

/** How long a from-the-queue grant may last. Anything longer belongs in the
 * agent's own settings, where an admin will see it. */
const MAX_GRANT_DAYS = 30;

/**
 * Decide several requests at once. Same checks as one — each row is
 * re-verified for org, status, expiry and the reviewer's capability —
 * so "approve all" can never wave through something the reviewer could
 * not have approved individually. Rows that fail a check are skipped and
 * named, not silently dropped, and do not block the rest.
 */
export async function decideApprovalsAction(
  approvalIds: string[],
  decision: "approve" | "reject",
  note?: string,
  grantDays?: number,
): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "reviewAgentWork", "decide an agent's request");
  if (refusal) return refusal;
  if (!approvalIds.length) return { ok: false, message: "Nothing selected." };
  if (grantDays !== undefined && (grantDays < 1 || grantDays > MAX_GRANT_DAYS || !Number.isInteger(grantDays))) {
    return { ok: false, message: `A standing approval lasts between 1 and ${MAX_GRANT_DAYS} days.` };
  }
  if (grantDays && decision !== "approve") {
    return { ok: false, message: "A standing approval only makes sense when approving." };
  }

  const orgId = session.workspace.organizationId;
  const rows = await db()
    .select()
    .from(schema.agentApprovals)
    .where(
      and(
        inArray(schema.agentApprovals.id, approvalIds),
        eq(schema.agentApprovals.organizationId, orgId),
      ),
    );

  const skipped: string[] = [];
  let decided = 0;
  const trimmedNote = note?.trim() || null;

  for (const approval of rows) {
    if (approval.status !== "pending") {
      skipped.push(`"${approval.title}" is already ${approval.status}`);
      continue;
    }
    if (approval.expiresAt.getTime() < Date.now()) {
      skipped.push(`"${approval.title}" has expired`);
      continue;
    }
    if (!canDecideApproval(session.workspace.role, approval.requiredCapability)) {
      skipped.push(`"${approval.title}" needs an admin or owner`);
      continue;
    }

    const updated = await db()
      .update(schema.agentApprovals)
      .set({
        status: decision === "approve" ? "approved" : "rejected",
        decidedBy: session.user.id,
        decidedAt: new Date(),
        decisionNote: trimmedNote,
      })
      // Status re-checked in the WHERE: two reviewers deciding the same row
      // at once must not both "win".
      .where(and(eq(schema.agentApprovals.id, approval.id), eq(schema.agentApprovals.status, "pending")))
      .returning({ id: schema.agentApprovals.id });
    if (!updated.length) {
      skipped.push(`"${approval.title}" was decided by someone else first`);
      continue;
    }
    decided++;

    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      actorAgentId: approval.agentId,
      action:
        decision === "approve"
          ? AUDIT_ACTIONS.agentActionApproved
          : AUDIT_ACTIONS.agentActionRejected,
      targetType: "agent_approval",
      targetId: approval.id,
      metadata: { tool: approval.toolName, title: approval.title, note: trimmedNote, batch: rows.length > 1 },
    });

    if (grantDays) {
      const expiresAt = new Date(Date.now() + grantDays * 86_400_000);
      // One grant per (agent, tool), not one per approved row: approving
      // five identical requests "for a week" is one decision. An existing
      // unexpired grant is extended rather than duplicated, so the
      // "Standing approvals" list stays a list of decisions, not of clicks.
      const [existing] = await db()
        .select({ id: schema.agentApprovalGrants.id, expiresAt: schema.agentApprovalGrants.expiresAt })
        .from(schema.agentApprovalGrants)
        .where(
          and(
            eq(schema.agentApprovalGrants.agentId, approval.agentId),
            eq(schema.agentApprovalGrants.toolName, approval.toolName),
            gt(schema.agentApprovalGrants.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.expiresAt < expiresAt) {
          await db()
            .update(schema.agentApprovalGrants)
            .set({ expiresAt, grantedBy: session.user.id, approvalId: approval.id })
            .where(eq(schema.agentApprovalGrants.id, existing.id));
        }
      } else {
        await db().insert(schema.agentApprovalGrants).values({
          organizationId: orgId,
          agentId: approval.agentId,
          toolName: approval.toolName,
          grantedBy: session.user.id,
          approvalId: approval.id,
          expiresAt,
        });
      }
      audit(db(), {
        organizationId: orgId,
        actorId: session.user.id,
        actorAgentId: approval.agentId,
        action: AUDIT_ACTIONS.agentActionGranted,
        targetType: "agent",
        targetId: approval.agentId,
        metadata: { tool: approval.toolName, days: grantDays, expiresAt: expiresAt.toISOString() },
      });
    }
  }

  const missing = approvalIds.length - rows.length;
  if (missing > 0) skipped.push(`${missing} request(s) not found`);

  revalidatePath("/agents/approvals");
  revalidatePath("/agents");

  if (!decided) {
    return { ok: false, message: skipped[0] ?? "Nothing could be decided." };
  }
  const verb = decision === "approve" ? "Approved" : "Rejected";
  const head =
    decided === 1 && approvalIds.length === 1
      ? `${verb}.`
      : `${verb} ${decided} of ${approvalIds.length}.`;
  return {
    ok: true,
    message: skipped.length ? `${head} Skipped: ${skipped.join("; ")}.` : head,
  };
}

/** Withdraw a time-boxed grant early. */
export async function revokeApprovalGrantAction(grantId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "reviewAgentWork", "withdraw a standing approval");
  if (refusal) return refusal;

  const deleted = await db()
    .delete(schema.agentApprovalGrants)
    .where(
      and(
        eq(schema.agentApprovalGrants.id, grantId),
        eq(schema.agentApprovalGrants.organizationId, session.workspace.organizationId),
      ),
    )
    .returning({ agentId: schema.agentApprovalGrants.agentId, toolName: schema.agentApprovalGrants.toolName });
  if (!deleted.length) return { ok: false, message: "No such standing approval." };

  audit(db(), {
    organizationId: session.workspace.organizationId,
    actorId: session.user.id,
    actorAgentId: deleted[0]!.agentId,
    action: AUDIT_ACTIONS.agentActionGrantRevoked,
    targetType: "agent",
    targetId: deleted[0]!.agentId,
    metadata: { tool: deleted[0]!.toolName },
  });

  revalidatePath("/agents/approvals");
  revalidatePath(`/agents/${deleted[0]!.agentId}`);
  return { ok: true, message: "Withdrawn — the agent will ask again next time." };
}

/**
 * The workspace kill switch.
 *
 * Pausing stops every agent in the workspace at once: nothing new is
 * enqueued, queued shifts are not started, a shift in progress stops at its
 * next turn, and approved actions are not carried out — all until resumed.
 * Nothing is discarded. Gated on `manageAgents` like pausing one agent; the
 * ability to stop everything is the one agent control that should be
 * *easier* to reach, not harder.
 */
export async function setAutomationPausedAction(paused: boolean): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageAgents", "pause or resume all automation");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const updated = await db()
    .update(schema.organizations)
    .set(
      paused
        ? { automationPausedAt: new Date(), automationPausedBy: session.user.id, updatedAt: new Date() }
        : { automationPausedAt: null, automationPausedBy: null, updatedAt: new Date() },
    )
    .where(
      and(
        eq(schema.organizations.id, orgId),
        // Idempotent: pausing twice keeps the original timestamp and actor.
        paused ? isNull(schema.organizations.automationPausedAt) : undefined,
      ),
    )
    .returning({ id: schema.organizations.id });

  if (updated.length) {
    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: paused ? AUDIT_ACTIONS.automationPaused : AUDIT_ACTIONS.automationResumed,
      targetType: "organization",
      targetId: orgId,
      metadata: {},
    });
  }

  revalidatePath("/agents");
  revalidatePath("/agents/approvals");
  revalidatePath("/settings");
  return {
    ok: true,
    message: paused
      ? "All automation paused. Agents will not run and approved actions will not be carried out until you resume."
      : "Automation resumed.",
  };
}

/**
 * Where, besides owners' and admins' email, to announce a waiting approval.
 * `null` clears it. Verified to be this workspace's own channel: the column
 * is not a foreign key.
 */
export async function setApprovalNotifyChannelAction(channelId: string | null): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageAgents", "change where approvals are announced");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  if (channelId) {
    const [channel] = await db()
      .select({ id: schema.alertChannels.id, kind: schema.alertChannels.kind })
      .from(schema.alertChannels)
      .where(and(eq(schema.alertChannels.id, channelId), eq(schema.alertChannels.organizationId, orgId)))
      .limit(1);
    if (!channel) return { ok: false, message: "No such channel." };
    if (channel.kind === "agent") {
      return { ok: false, message: "An agent cannot be told about approvals — pick a Slack, webhook or email channel." };
    }
  }

  await db()
    .update(schema.organizations)
    .set({ approvalNotifyChannelId: channelId, updatedAt: new Date() })
    .where(eq(schema.organizations.id, orgId));

  revalidatePath("/settings");
  return { ok: true, message: channelId ? "Approvals will be announced there too." : "Approvals are announced by email only." };
}

/** The roster, for the hire dialog. Server-side so presets stay one source. */
export async function listPresetsAction(): Promise<typeof AGENT_PRESETS> {
  return AGENT_PRESETS;
}
