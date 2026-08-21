import { and, desc, eq } from "drizzle-orm";
import { createClickHouse, createDatabase, schema } from "@falorb/db";
import { executeApproval, executeRun } from "./run";
import { getPreset } from "./presets";

/**
 * Drives one agent through a real shift against a live database and a live
 * model.
 *
 * Same purpose as `apps/worker/src/verify-jobs.ts`: the scheduler runs this
 * path on a multi-minute beat, which makes "does the loop actually work"
 * impractical to answer by waiting. This forces the whole chain — briefing,
 * tool calls, policy gating, approval raising, transcript persistence,
 * approval execution — through in one go.
 *
 * It spends real OpenRouter credit, so it is deliberately not wired into
 * `pnpm test`, for the same reason `clay-enrichment` and `ugc-video-gen` are
 * excluded from `verify:jobs`.
 *
 *   FALORB_VERIFY_ORG=<uuid> pnpm --filter @falorb/agents verify
 */

const AGENT_NAME = "Verify Analyst";

async function main(): Promise<void> {
  const db = createDatabase();
  const clickhouse = createClickHouse();

  const orgId = process.env.FALORB_VERIFY_ORG;
  const [org] = orgId
    ? await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1)
    : await db.select().from(schema.organizations).limit(1);
  if (!org) throw new Error("No organization found. Run the seed first.");

  const projects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.organizationId, org.id));
  console.log(`Workspace: ${org.name} (${projects.length} properties)\n`);
  if (!projects.length) {
    throw new Error("That workspace has no properties — the agent would have nothing to read.");
  }

  const preset = getPreset("growth-analyst")!;

  const [existing] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.organizationId, org.id), eq(schema.agents.name, AGENT_NAME)))
    .limit(1);

  const agent =
    existing ??
    (
      await db
        .insert(schema.agents)
        .values({
          organizationId: org.id,
          name: AGENT_NAME,
          roleTitle: preset.roleTitle,
          avatar: preset.avatar,
          preset: preset.key,
          instructions: preset.instructions,
          role: "member",
          autonomy: "assisted",
          toolkits: preset.toolkits,
          projectIds: [],
          maxStepsPerRun: 8,
        })
        .returning()
    )[0]!;

  console.log(`→ Agent ${agent.avatar} ${agent.name} (${agent.role}, ${agent.autonomy})`);
  console.log(`  toolkits: ${agent.toolkits.join(", ")}\n`);

  const [run] = await db
    .insert(schema.agentRuns)
    .values({
      organizationId: org.id,
      agentId: agent.id,
      trigger: "manual",
      objective:
        "Check how the portfolio performed over the last 30 days. Establish the headline " +
        "numbers, look at where traffic came from, and report what stands out. If something " +
        "needs a human's attention, open a task for it.",
    })
    .returning();

  console.log("→ Running the shift…\n");
  const started = Date.now();
  const outcome = await executeRun(
    { db, clickhouse, onLog: (_, message) => console.log(`   · ${message}`) },
    run!.id,
  );

  console.log(`\n→ ${outcome.status} in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(`  ${outcome.steps} steps, ${outcome.approvalsRaised} approval(s) raised\n`);

  const steps = await db
    .select()
    .from(schema.agentSteps)
    .where(eq(schema.agentSteps.runId, run!.id))
    .orderBy(schema.agentSteps.position);

  console.log("Transcript:");
  for (const step of steps) {
    const label = step.toolName ? `${step.kind}:${step.toolName}` : step.kind;
    const detail = step.content
      ? step.content.replace(/\s+/g, " ").slice(0, 110)
      : JSON.stringify(step.result ?? {}).slice(0, 110);
    console.log(`  ${String(step.position).padStart(2)} ${label.padEnd(28)} ${detail}`);
  }

  const [final] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, run!.id))
    .limit(1);
  console.log(`\nReport:\n${final?.summary ?? final?.error ?? "(none)"}\n`);
  console.log(
    `Cost: $${Number(final?.costUsd ?? 0).toFixed(4)} · ` +
      `${(final?.promptTokens ?? 0) + (final?.completionTokens ?? 0)} tokens`,
  );

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.creatorAgentId, agent.id))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(5);
  if (tasks.length) {
    console.log(`\nTasks it opened:`);
    for (const task of tasks) {
      console.log(`  · [${task.status}] ${task.title}${task.handoffReason ? ` — ${task.handoffReason}` : ""}`);
    }
  }

  const memories = await db
    .select()
    .from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, agent.id));
  if (memories.length) {
    console.log(`\nWhat it remembered:`);
    for (const memory of memories) console.log(`  · ${memory.key}: ${memory.content}`);
  }

  /**
   * A second, deliberately-gated shift.
   *
   * The first run is realistic but not deterministic: an agent that honestly
   * concludes nothing needs doing never calls a write tool, and so never
   * exercises the gate. This one asks for a write directly. `create_task` is
   * an `internal` effect, and the agent is `assisted`, so policy must queue
   * it rather than perform it — if a task row appears without an approval
   * row, the gate has a hole.
   */
  console.log("\n→ Second shift, forcing the approval path…\n");
  const [gateRun] = await db
    .insert(schema.agentRuns)
    .values({
      organizationId: org.id,
      agentId: agent.id,
      trigger: "manual",
      objective:
        "Open one task on the shared board titled 'Confirm tracking on unused properties', " +
        "describing that two properties show zero sessions and someone should check whether " +
        "their tracking snippet was ever installed. Then stop.",
    })
    .returning();

  const tasksBefore = (
    await db.select().from(schema.tasks).where(eq(schema.tasks.creatorAgentId, agent.id))
  ).length;

  const gateOutcome = await executeRun({ db, clickhouse }, gateRun!.id);
  const tasksAfter = (
    await db.select().from(schema.tasks).where(eq(schema.tasks.creatorAgentId, agent.id))
  ).length;

  console.log(`  ${gateOutcome.status}, ${gateOutcome.approvalsRaised} approval(s) raised`);
  console.log(
    tasksAfter === tasksBefore
      ? "  ✓ gate held — no task was written directly"
      : `  ✗ GATE LEAKED — ${tasksAfter - tasksBefore} task(s) written without approval`,
  );

  const pending = await db
    .select()
    .from(schema.agentApprovals)
    .where(
      and(
        eq(schema.agentApprovals.agentId, agent.id),
        eq(schema.agentApprovals.status, "pending"),
      ),
    );

  if (pending.length) {
    console.log(`\nApproval queue (${pending.length}):`);
    for (const approval of pending) {
      console.log(`  · [${approval.risk}] ${approval.title} (${approval.toolName})`);
    }

    const first = pending[0]!;
    await db
      .update(schema.agentApprovals)
      .set({ status: "approved", decidedAt: new Date() })
      .where(eq(schema.agentApprovals.id, first.id));

    const executed = await executeApproval({ db, clickhouse }, first.id);
    console.log(`\n→ Approved and executed "${first.title}": ${executed.ok ? "ok" : executed.detail}`);

    const after = (
      await db.select().from(schema.tasks).where(eq(schema.tasks.creatorAgentId, agent.id))
    ).length;
    console.log(
      after > tasksAfter
        ? "  ✓ the approved action actually happened"
        : "  ✗ approval executed but nothing changed",
    );
  } else {
    console.log("\nNo approvals raised this shift.");
  }

  /**
   * `audit()` is fire-and-forget by design (see `packages/db/src/audit.ts`),
   * so counting immediately races the insert — the first verification run
   * reported zero rows for actions that had in fact been logged. The worker
   * outlives its writes; a script that exits does not.
   */
  await new Promise((resolve) => setTimeout(resolve, 500));

  const auditRows = await db
    .select({ action: schema.auditLog.action, target: schema.auditLog.targetType })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.actorAgentId, agent.id))
    .limit(10);
  console.log(
    `\nAudit rows attributed to this agent: ${auditRows.length}` +
      (auditRows.length ? ` (${auditRows.map((r) => r.action).join(", ")})` : ""),
  );

  await clickhouse.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("\nVerification failed:", error);
  process.exit(1);
});
