import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export interface ConsentRecordRow {
  id: string;
  distinctId: string;
  granted: boolean;
  policyVersion: string | null;
  recordedAt: Date;
}

export interface ListConsentRecordsOptions {
  projectId: number;
  granted?: boolean;
  limit?: number;
  offset?: number;
}

/** The lawful-basis paper trail for one property, newest decision first. */
export async function listConsentRecords(
  options: ListConsentRecordsOptions,
): Promise<{ rows: ConsentRecordRow[]; total: number; hasMore: boolean }> {
  const { projectId, granted, limit = 50, offset = 0 } = options;

  const conditions = [eq(schema.consentRecords.projectId, projectId)];
  if (granted !== undefined) conditions.push(eq(schema.consentRecords.granted, granted ? 1 : 0));
  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db()
      .select()
      .from(schema.consentRecords)
      .where(where)
      .orderBy(desc(schema.consentRecords.recordedAt))
      .limit(limit + 1)
      .offset(offset),
    db().select({ value: count() }).from(schema.consentRecords).where(where),
  ]);

  const hasMore = rows.length > limit;
  return {
    rows: rows.slice(0, limit).map((r) => ({
      id: r.id,
      distinctId: r.distinctId,
      granted: r.granted === 1,
      policyVersion: r.policyVersion,
      recordedAt: r.recordedAt,
    })),
    total: totalRows[0]?.value ?? 0,
    hasMore,
  };
}
