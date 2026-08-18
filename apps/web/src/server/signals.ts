import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import type { SignalKind } from "./ai";

/**
 * Cached AI recommendations, read from Postgres.
 *
 * Generation (the OpenRouter call in `./ai.ts`) is triggered on demand by a
 * server action, not on every page load — an LLM call is slow and costs money
 * on data that only meaningfully changes over hours. This module only reads
 * whatever was last generated; see `actions/signals.ts` for the write path.
 */

export type AiSignalRow = typeof schema.aiSignals.$inferSelect;

/**
 * `projectId: null` reads a portfolio-wide signal (currently only the "sales"
 * kind's portfolio scope) — same nullable-scope shape as `dashboards`, and the
 * same reason `eq()` can't be used for it: SQL's `= NULL` is never true, so
 * the null case needs its own `isNull()` branch.
 */
export async function getLatestSignal(
  projectId: number | null,
  kind: SignalKind,
): Promise<AiSignalRow | null> {
  const [row] = await db()
    .select()
    .from(schema.aiSignals)
    .where(
      and(
        projectId == null
          ? isNull(schema.aiSignals.projectId)
          : eq(schema.aiSignals.projectId, projectId),
        eq(schema.aiSignals.kind, kind),
      ),
    )
    .orderBy(desc(schema.aiSignals.generatedAt))
    .limit(1);

  return row ?? null;
}
