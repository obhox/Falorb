import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export type PersonMergeRow = typeof schema.personMerges.$inferSelect;

/** Merges this person has absorbed, newest first — reversible ones (no
 * `revertedAt`) can still be unmerged from the UI. */
export async function listMergeHistory(
  organizationId: string,
  survivorId: string,
): Promise<PersonMergeRow[]> {
  return db()
    .select()
    .from(schema.personMerges)
    .where(
      and(
        eq(schema.personMerges.organizationId, organizationId),
        eq(schema.personMerges.survivorId, survivorId),
      ),
    )
    .orderBy(desc(schema.personMerges.createdAt))
    .limit(20);
}
