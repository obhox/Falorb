import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { FunnelStep } from "@falorb/queries";

/**
 * Saved funnel definitions.
 *
 * The builder itself keeps its state in the URL, which is what makes a funnel
 * shareable. That is a good property and this does not replace it — it gives
 * the URL somewhere to come *from*. Without this, the `funnels` table is
 * unreachable from the interface: a team's named funnels ("Trial to
 * subscription") exist in the database and the only way to see one is for
 * somebody to remember its steps and retype them.
 */

export type FunnelRow = typeof schema.funnels.$inferSelect;

export interface SavedFunnel {
  id: string;
  name: string;
  description: string | null;
  steps: FunnelStep[];
  windowHours: number;
}

/**
 * Steps are stored as jsonb, so what comes back is `unknown` no matter what
 * the column's TypeScript type claims. A row written by an older version of
 * the builder — or by hand — must not be able to crash the page, so anything
 * that is not a usable step is dropped rather than trusted.
 */
function toSteps(raw: unknown): FunnelStep[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): FunnelStep[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    const event = typeof candidate.event === "string" ? candidate.event : undefined;
    const label = typeof candidate.label === "string" ? candidate.label : event;
    if (!event && !Array.isArray(candidate.filters)) return [];

    return [
      {
        label: label ?? "Step",
        event,
        filters: Array.isArray(candidate.filters)
          ? (candidate.filters as FunnelStep["filters"])
          : undefined,
      },
    ];
  });
}

export async function listFunnels(projectId: number): Promise<SavedFunnel[]> {
  const rows = await db()
    .select()
    .from(schema.funnels)
    .where(eq(schema.funnels.projectId, projectId))
    .orderBy(asc(schema.funnels.createdAt));

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      steps: toSteps(row.steps),
      windowHours: row.windowHours,
    }))
    // A funnel needs two steps to be a funnel; one that lost its definition is
    // not worth offering as a link that leads to an error.
    .filter((funnel) => funnel.steps.length >= 2);
}
