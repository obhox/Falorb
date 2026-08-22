import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@falorb/db";
import { AGENT_PRESETS, AUTONOMY_LEVELS, TOOLKITS, getPreset, isAutonomy, isToolkit } from "@falorb/agents";
import type { McpContext } from "../context";
import { requireScope } from "../context";
import { ago, failure, num, table, text } from "../format";

/**
 * AI employees — the roster, task assignment, shifts, and the approval
 * queue. Same tables `apps/web/src/server/actions/agents.ts` drives from the
 * dashboard.
 *
 * `role` is capped at "member" through this server, never "admin" or
 * "owner" — the dashboard's own `canGrantAgentRole` stops a granter from
 * creating an agent above their own role specifically so an admin cannot
 * mint an `owner` agent and get owner powers by proxy. An MCP write-scope
 * key carries no per-human role to compare against, so the safe substitute
 * is a flat ceiling rather than trusting the caller's own claim: an MCP
 * client can hire and run agents, but never one with admin/owner-tier
 * permissions (team management, integration credentials, project
 * archival). Use the dashboard to grant a higher role.
 *
 * `decide_agent_approval` similarly has no per-human capability to check the
 * reviewer against (`canDecideApproval` in the dashboard requires the
 * reviewer hold the same capability as the gated tool) — an MCP write-scope
 * key is treated as sufficient on its own, since it already has unilateral
 * write access to everything else this server exposes.
 */

const MCP_AGENT_ROLES = ["viewer", "member"] as const;
const AGENT_STATUSES = ["active", "paused"] as const;
const MAX_INSTRUCTIONS = 8000;

export function registerAgentTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_agents",
    {
      title: "List AI employees",
      description: "The agent roster — name, job title, role, autonomy, and whether it's on shift.",
      inputSchema: { include_archived: z.boolean().default(false) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ include_archived }) => {
      const { db, scope } = ctx();
      try {
        const rows = (
          await db
            .select({ agent: schema.agents, email: schema.emailAccounts.address, emailStatus: schema.emailAccounts.status })
            .from(schema.agents)
            .leftJoin(schema.emailAccounts, eq(schema.emailAccounts.id, schema.agents.emailAccountId))
            .where(eq(schema.agents.organizationId, scope.organizationId))
            .orderBy(desc(schema.agents.createdAt))
        ).map((r) => ({ ...r.agent, email: r.emailStatus === "active" ? r.email : null }));

        const visible = include_archived ? rows : rows.filter((r) => r.status !== "archived");

        return text(
          table(
            visible,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Name", get: (r) => `${r.avatar} ${r.name}` },
              { header: "Title", get: (r) => r.roleTitle },
              { header: "Email", get: (r) => r.email ?? "—" },
              { header: "Role", get: (r) => r.role },
              { header: "Autonomy", get: (r) => r.autonomy },
              { header: "Status", get: (r) => r.status },
              { header: "Toolkits", get: (r) => r.toolkits.join(", ") },
              { header: "Shift", get: (r) => (r.scheduleMinutes ? `every ${r.scheduleMinutes}m` : "on demand") },
            ],
            "No agents hired yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_agent",
    {
      title: "Read an agent",
      description: "One agent's full brief, permissions, schedule, and budget.",
      inputSchema: { agent_id: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ agent_id }) => {
      const { db, scope } = ctx();
      try {
        const [row] = await db
          .select({ agent: schema.agents, email: schema.emailAccounts.address, emailStatus: schema.emailAccounts.status })
          .from(schema.agents)
          .leftJoin(schema.emailAccounts, eq(schema.emailAccounts.id, schema.agents.emailAccountId))
          .where(and(eq(schema.agents.id, agent_id), eq(schema.agents.organizationId, scope.organizationId)))
          .limit(1);
        if (!row) return failure("No such agent in this workspace.");
        const agent = row.agent;
        const email = row.emailStatus === "active" ? row.email : null;

        return text(
          `# ${agent.avatar} ${agent.name} — ${agent.roleTitle}\n\n` +
            (email ? `Email: ${email}\n` : "") +
            `Role: **${agent.role}**  ·  Autonomy: **${agent.autonomy}**  ·  Status: **${agent.status}**\n` +
            `Toolkits: ${agent.toolkits.join(", ") || "none"}\n` +
            `Auto-approved tools: ${agent.autoApproveTools.join(", ") || "none"}\n` +
            `Shift: ${agent.scheduleMinutes ? `every ${agent.scheduleMinutes} minutes` : "on demand only"}` +
            (agent.nextRunAt ? `, next at ${agent.nextRunAt.toISOString()}` : "") +
            `\nBudget: ${agent.maxStepsPerRun} turns/run, ${agent.dailyRunLimit} runs/day` +
            (agent.dailyTokenLimit ? `, ${num(agent.dailyTokenLimit)} tokens/day` : ", uncapped tokens") +
            `\n\n### Brief\n${agent.instructions}` +
            (agent.scheduleObjective ? `\n\n### Standing objective\n${agent.scheduleObjective}` : ""),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "hire_agent",
    {
      title: "Hire an AI employee",
      description:
        "Create an agent from a preset or from scratch: a name, job title, brief, role, autonomy, " +
        "toolkits, and optionally a recurring shift. `role` is capped at \"member\" through this " +
        "server (see this toolset's own notes) — use the dashboard to grant admin/owner. A new hire " +
        "does not run until assigned a task or its first shift is due. Requires the write scope.",
      inputSchema: {
        preset: z.string().optional().describe(`One of: ${AGENT_PRESETS.map((p) => p.key).join(", ")}. Fields you also pass override the preset.`),
        name: z.string().max(60).optional(),
        role_title: z.string().optional(),
        instructions: z.string().min(20).max(MAX_INSTRUCTIONS).optional().describe("The manager's brief. At least 20 characters."),
        role: z.enum(MCP_AGENT_ROLES).optional(),
        autonomy: z.enum(AUTONOMY_LEVELS).optional(),
        toolkits: z.array(z.enum(TOOLKITS)).optional(),
        avatar: z.string().optional().describe("A single emoji."),
        schedule_minutes: z.number().int().min(15).optional().describe("Recurring shift interval. Omit for on-demand only."),
        schedule_objective: z.string().optional().describe("What to do each scheduled shift."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ preset: presetKey, name, role_title, instructions, role, autonomy, toolkits, avatar, schedule_minutes, schedule_objective }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const preset = presetKey ? getPreset(presetKey) : undefined;
        if (presetKey && !preset) return failure(`Unknown preset "${presetKey}". Options: ${AGENT_PRESETS.map((p) => p.key).join(", ")}.`);

        const finalName = (name?.trim() || preset?.name || "").slice(0, 60);
        if (!finalName) return failure("Give the agent a name, or a preset that has one.");

        const finalTitle = role_title?.trim() || preset?.roleTitle;
        if (!finalTitle) return failure("Give the agent a job title, or a preset that has one.");

        const finalInstructions = (instructions?.trim() || preset?.instructions || "").trim();
        if (finalInstructions.length < 20) return failure("The brief must be at least 20 characters, or come from a preset.");

        const finalRole = role ?? (preset && MCP_AGENT_ROLES.includes(preset.role as (typeof MCP_AGENT_ROLES)[number]) ? preset.role : "viewer");
        if (!MCP_AGENT_ROLES.includes(finalRole as (typeof MCP_AGENT_ROLES)[number])) {
          return failure(`Through this server, an agent's role is capped at "member". Use the dashboard for admin/owner.`);
        }

        const finalAutonomy = autonomy ?? (preset && isAutonomy(preset.autonomy) ? preset.autonomy : "assisted");
        const finalToolkits = toolkits ?? preset?.toolkits.filter(isToolkit) ?? [];

        const [existing] = await db
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(and(eq(schema.agents.organizationId, scope.organizationId), eq(schema.agents.name, finalName)))
          .limit(1);
        if (existing) return failure(`You already have an agent called ${finalName}.`);

        const [created] = await db
          .insert(schema.agents)
          .values({
            organizationId: scope.organizationId,
            name: finalName,
            roleTitle: finalTitle,
            avatar: avatar?.trim() || preset?.avatar || "🤖",
            preset: preset?.key ?? "custom",
            instructions: finalInstructions,
            role: finalRole,
            autonomy: finalAutonomy,
            toolkits: finalToolkits,
            scheduleMinutes: schedule_minutes ?? preset?.scheduleMinutes ?? null,
            scheduleObjective: schedule_objective?.trim() || preset?.scheduleObjective || null,
            nextRunAt: schedule_minutes ? new Date(Date.now() + schedule_minutes * 60_000) : null,
          })
          .returning({ id: schema.agents.id });

        return text(`Hired **${finalName}** (\`${created!.id}\`) — ${finalTitle}, role ${finalRole}, autonomy ${finalAutonomy}.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "update_agent",
    {
      title: "Change an agent",
      description: "Edit an existing agent's brief, role (capped at \"member\"), autonomy, toolkits, or schedule. Only the fields you pass change. Requires the write scope.",
      inputSchema: {
        agent_id: z.string().uuid(),
        instructions: z.string().min(20).max(MAX_INSTRUCTIONS).optional(),
        role_title: z.string().optional(),
        role: z.enum(MCP_AGENT_ROLES).optional(),
        autonomy: z.enum(AUTONOMY_LEVELS).optional(),
        toolkits: z.array(z.enum(TOOLKITS)).optional(),
        schedule_minutes: z.number().int().min(15).optional().describe('Set to 0 to clear the recurring shift.'),
        schedule_objective: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ agent_id, instructions, role_title, role, autonomy, toolkits, schedule_minutes, schedule_objective }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [agent] = await db
          .select({ id: schema.agents.id })
          .from(schema.agents)
          .where(and(eq(schema.agents.id, agent_id), eq(schema.agents.organizationId, scope.organizationId)))
          .limit(1);
        if (!agent) return failure("No such agent.");

        const patch: Partial<typeof schema.agents.$inferInsert> = { updatedAt: new Date() };
        if (instructions !== undefined) patch.instructions = instructions;
        if (role_title !== undefined) patch.roleTitle = role_title;
        if (role !== undefined) patch.role = role;
        if (autonomy !== undefined) patch.autonomy = autonomy;
        if (toolkits !== undefined) patch.toolkits = toolkits;
        if (schedule_minutes !== undefined) {
          patch.scheduleMinutes = schedule_minutes || null;
          patch.nextRunAt = schedule_minutes ? new Date(Date.now() + schedule_minutes * 60_000) : null;
        }
        if (schedule_objective !== undefined) patch.scheduleObjective = schedule_objective || null;

        await db.update(schema.agents).set(patch).where(eq(schema.agents.id, agent_id));
        return text("Saved.");
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_agent_status",
    {
      title: "Pause or resume an agent",
      description: "A paused agent keeps its history and assignments but is skipped by the scheduler. Requires the write scope.",
      inputSchema: { agent_id: z.string().uuid(), status: z.enum(AGENT_STATUSES) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ agent_id, status }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const updated = await db
          .update(schema.agents)
          .set({
            status,
            updatedAt: new Date(),
            ...(status === "active" ? { nextRunAt: new Date(Date.now() + 60_000) } : { nextRunAt: null }),
          })
          .where(and(eq(schema.agents.id, agent_id), eq(schema.agents.organizationId, scope.organizationId)))
          .returning({ name: schema.agents.name });
        if (!updated.length) return failure("No such agent.");
        return text(status === "paused" ? `${updated[0]!.name} paused.` : `${updated[0]!.name} back on shift.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "retire_agent",
    {
      title: "Retire an agent",
      description: "Archive an agent — its runs, approvals, and everything it did stay as audit history. Never deleted. Requires the write scope.",
      inputSchema: { agent_id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ agent_id }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const updated = await db
          .update(schema.agents)
          .set({ status: "archived", nextRunAt: null, updatedAt: new Date() })
          .where(and(eq(schema.agents.id, agent_id), eq(schema.agents.organizationId, scope.organizationId)))
          .returning({ name: schema.agents.name });
        if (!updated.length) return failure("No such agent.");
        return text(`${updated[0]!.name} has been retired.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "run_agent_now",
    {
      title: "Start an agent's shift now",
      description:
        "Queue an immediate shift instead of waiting for the schedule. Costs a real model call. " +
        "Requires the write scope.",
      inputSchema: {
        agent_id: z.string().uuid(),
        objective: z.string().optional().describe("What to do this shift. Defaults to the agent's standing objective."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ agent_id, objective }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [agent] = await db
          .select()
          .from(schema.agents)
          .where(and(eq(schema.agents.id, agent_id), eq(schema.agents.organizationId, scope.organizationId)))
          .limit(1);
        if (!agent) return failure("No such agent.");
        if (agent.status !== "active") return failure(`${agent.name} is paused.`);

        const [run] = await db
          .insert(schema.agentRuns)
          .values({
            organizationId: scope.organizationId,
            agentId: agent_id,
            trigger: "manual",
            objective:
              objective?.trim() ||
              agent.scheduleObjective?.trim() ||
              "Do your regular round: review what has changed in your area, and act on anything that needs it.",
          })
          .returning({ id: schema.agentRuns.id });

        return text(`Queued — ${agent.name}'s shift starts within a couple of minutes (run \`${run!.id}\`).`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_agent_runs",
    {
      title: "List agent runs",
      description: "Shift history for one agent or the whole roster — status, cost, and the closing summary.",
      inputSchema: {
        agent_id: z.string().uuid().optional().describe("Omit for every agent."),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ agent_id, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.agentRuns.organizationId, scope.organizationId)];
        if (agent_id) conditions.push(eq(schema.agentRuns.agentId, agent_id));

        const rows = await db
          .select()
          .from(schema.agentRuns)
          .where(and(...conditions))
          .orderBy(desc(schema.agentRuns.createdAt))
          .limit(limit);

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Trigger", get: (r) => r.trigger },
              { header: "Status", get: (r) => r.status },
              { header: "Turns", get: (r) => r.stepCount, align: "right" },
              { header: "Cost", get: (r) => `$${r.costUsd}` },
              { header: "Started", get: (r) => (r.startedAt ? ago(r.startedAt.toISOString()) : "queued") },
            ],
            "No runs yet.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "get_agent_run",
    {
      title: "Read a run's summary",
      description: "One agent shift's objective, status, cost, and closing report.",
      inputSchema: { run_id: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ run_id }) => {
      const { db, scope } = ctx();
      try {
        const [run] = await db
          .select()
          .from(schema.agentRuns)
          .where(and(eq(schema.agentRuns.id, run_id), eq(schema.agentRuns.organizationId, scope.organizationId)))
          .limit(1);
        if (!run) return failure("No such run.");

        return text(
          `Run \`${run.id}\` — ${run.trigger}, status **${run.status}**\n\n` +
            `Objective: ${run.objective}\n\n` +
            (run.summary ? `### Summary\n${run.summary}\n\n` : "") +
            (run.error ? `### Error\n${run.error}\n\n` : "") +
            `Turns: ${run.stepCount}  ·  Tokens: ${num(run.promptTokens + run.completionTokens)}  ·  Cost: $${run.costUsd}`,
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_agent_approvals",
    {
      title: "List queued agent approvals",
      description: "Actions an agent proposed that are waiting on a human (or this key) to decide. Pending by default.",
      inputSchema: { status: z.enum(["pending", "approved", "rejected", "expired", "executed", "failed"]).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.agentApprovals.organizationId, scope.organizationId)];
        conditions.push(eq(schema.agentApprovals.status, status ?? "pending"));

        const rows = await db
          .select()
          .from(schema.agentApprovals)
          .where(and(...conditions))
          .orderBy(desc(schema.agentApprovals.createdAt))
          .limit(50);

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Title", get: (r) => r.title },
              { header: "Tool", get: (r) => r.toolName },
              { header: "Risk", get: (r) => r.risk },
              { header: "Rationale", get: (r) => r.rationale },
              { header: "Expires", get: (r) => ago(r.expiresAt.toISOString()) },
            ],
            "Nothing queued.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "decide_agent_approval",
    {
      title: "Approve or reject a queued agent action",
      description:
        "Decide a pending approval. Approving does not execute it immediately — the worker carries " +
        "it out within a minute, through the same code path the agent would have used. Requires the " +
        "write scope.",
      inputSchema: {
        approval_id: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().optional().describe("Fed back to the agent as the tool result if rejected."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ approval_id, decision, note }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        const [approval] = await db
          .select()
          .from(schema.agentApprovals)
          .where(and(eq(schema.agentApprovals.id, approval_id), eq(schema.agentApprovals.organizationId, scope.organizationId)))
          .limit(1);
        if (!approval) return failure("No such request.");
        if (approval.status !== "pending") return failure(`That request is already ${approval.status}.`);
        if (approval.expiresAt.getTime() < Date.now()) {
          return failure("That request has expired. Ask the agent to propose it again.");
        }

        await db
          .update(schema.agentApprovals)
          .set({
            status: decision === "approve" ? "approved" : "rejected",
            decidedAt: new Date(),
            decisionNote: note?.trim() || null,
          })
          .where(eq(schema.agentApprovals.id, approval_id));

        return text(
          decision === "approve"
            ? "Approved — it will be carried out within a minute."
            : "Rejected. The agent will not retry it.",
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
