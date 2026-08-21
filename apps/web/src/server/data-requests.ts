import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export type DataRequestRow = typeof schema.dataRequests.$inferSelect;

/** GDPR export/erasure history for one person, newest first. */
export async function listDataRequests(
  organizationId: string,
  personId: string,
): Promise<DataRequestRow[]> {
  return db()
    .select()
    .from(schema.dataRequests)
    .where(
      and(
        eq(schema.dataRequests.organizationId, organizationId),
        eq(schema.dataRequests.personId, personId),
      ),
    )
    .orderBy(desc(schema.dataRequests.createdAt))
    .limit(20);
}
