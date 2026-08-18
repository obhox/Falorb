import "server-only";
import { and, desc, eq } from "drizzle-orm";
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

export async function getLatestSignal(
  projectId: number,
  kind: SignalKind,
): Promise<AiSignalRow | null> {
  const [row] = await db()
    .select()
    .from(schema.aiSignals)
    .where(and(eq(schema.aiSignals.projectId, projectId), eq(schema.aiSignals.kind, kind)))
    .orderBy(desc(schema.aiSignals.generatedAt))
    .limit(1);

  return row ?? null;
}
