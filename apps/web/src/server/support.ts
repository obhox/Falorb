import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * The Bund AI support mirror, read-side. Written by
 * `apps/worker/src/jobs/bund-ai-sync.ts`; this file only reads it.
 */

export type SupportEscalationRow = typeof schema.supportEscalations.$inferSelect;

export async function listEscalations(organizationId: string): Promise<SupportEscalationRow[]> {
  return db()
    .select()
    .from(schema.supportEscalations)
    .where(eq(schema.supportEscalations.organizationId, organizationId))
    .orderBy(desc(schema.supportEscalations.bundAiCreatedAt))
    .limit(200);
}

export async function isBundAiConnected(organizationId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.integrationConnections.id })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        eq(schema.integrationConnections.provider, "bund_ai"),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
