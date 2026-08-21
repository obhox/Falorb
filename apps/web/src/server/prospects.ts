import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export type ProspectRow = typeof schema.prospects.$inferSelect;

export interface ListProspectsOptions {
  organizationId: string;
  status?: string;
  limit?: number;
}

/**
 * Prospects for the org-wide `/prospecting` page. Ordered by discovery time
 * rather than relevance score, since Postgres sorts NULLs first on a DESC
 * ordering — an unscored (relevance-scoring-failed) prospect sorting itself
 * to the very top of a relevance-ranked list would be backwards.
 */
export async function listProspects(options: ListProspectsOptions): Promise<ProspectRow[]> {
  const { organizationId, status, limit = 100 } = options;
  const conditions = [eq(schema.prospects.organizationId, organizationId)];
  if (status) conditions.push(eq(schema.prospects.status, status));

  return db()
    .select()
    .from(schema.prospects)
    .where(and(...conditions))
    .orderBy(desc(schema.prospects.createdAt))
    .limit(limit);
}

export async function getProspect(id: string, organizationId: string): Promise<ProspectRow | null> {
  const [row] = await db()
    .select()
    .from(schema.prospects)
    .where(and(eq(schema.prospects.id, id), eq(schema.prospects.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}
