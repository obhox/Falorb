import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { DateRange, GoalDefinition, GoalResult } from "@falorb/queries";
import { goalConversions } from "./analytics";

/**
 * Goals, read from Postgres and evaluated in ClickHouse.
 *
 * The evaluation itself lives in `@falorb/queries` so that a goal counted on
 * this page, in a webhook payload and in an alert all mean the same thing —
 * three definitions of "converted" is worse than one that is slightly off.
 * This module only bridges the two: it turns stored rows into the query
 * layer's `GoalDefinition` shape.
 */

export type GoalRow = typeof schema.goals.$inferSelect;

export async function listGoals(projectId: number): Promise<GoalRow[]> {
  return db()
    .select()
    .from(schema.goals)
    .where(eq(schema.goals.projectId, projectId))
    .orderBy(asc(schema.goals.createdAt));
}

/** Stored row -> the query layer's definition. */
export function toDefinition(goal: GoalRow): GoalDefinition {
  return {
    id: goal.id,
    name: goal.name,
    kind: goal.kind === "path" ? "path" : "event",
    matcher: goal.matcher,
    value: goal.value == null ? null : Number(goal.value),
  };
}

export interface EvaluatedGoal extends GoalResult {
  goal: GoalRow;
  /**
   * True when the goal's assumed per-conversion value contributed to revenue.
   *
   * The query sums `ifNull(revenue, value)` per event, so a goal with a value
   * always reports *something*. Whether that figure was measured or assumed is
   * not visible in the number itself, and presenting an estimate beside real
   * revenue without saying which is which is how an estimate ends up in a
   * board deck as fact.
   */
  revenueMayBeAssumed: boolean;
}

export async function evaluateGoals(
  projectId: number,
  range: DateRange,
  goals: GoalRow[],
): Promise<EvaluatedGoal[]> {
  const active = goals.filter((goal) => goal.active);
  if (active.length === 0) return [];

  const results = await goalConversions({
    projectIds: [projectId],
    range,
    goals: active.map(toDefinition),
  });

  const byId = new Map(results.map((result) => [result.goalId, result]));

  return active.map((goal) => {
    const result = byId.get(goal.id);
    return {
      goalId: goal.id,
      name: goal.name,
      conversions: result?.conversions ?? 0,
      uniqueConverters: result?.uniqueConverters ?? 0,
      conversionRate: result?.conversionRate ?? 0,
      revenue: result?.revenue ?? 0,
      goal,
      revenueMayBeAssumed: goal.value != null && Number(goal.value) > 0,
    };
  });
}
