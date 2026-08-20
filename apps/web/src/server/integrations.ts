import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export type IntegrationRow = typeof schema.integrations.$inferSelect;

export async function getIntegration(
  organizationId: string,
  kind: string,
): Promise<IntegrationRow | null> {
  const [row] = await db()
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.organizationId, organizationId), eq(schema.integrations.kind, kind)))
    .limit(1);
  return row ?? null;
}
