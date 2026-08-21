import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface ListAuditLogOptions {
  organizationId: string;
  action?: string;
  limit?: number;
  offset?: number;
}

/** Who changed what, newest first — same `{rows, total, hasMore}` shape as `listPeople`. */
export async function listAuditLog(
  options: ListAuditLogOptions,
): Promise<{ rows: AuditLogRow[]; total: number; hasMore: boolean }> {
  const { organizationId, action, limit = 50, offset = 0 } = options;

  const conditions = [eq(schema.auditLog.organizationId, organizationId)];
  if (action) conditions.push(eq(schema.auditLog.action, action));
  const where = and(...conditions);

  const [rows, totalRows] = await Promise.all([
    db()
      .select({
        id: schema.auditLog.id,
        actorId: schema.auditLog.actorId,
        actorName: schema.user.name,
        actorEmail: schema.user.email,
        action: schema.auditLog.action,
        targetType: schema.auditLog.targetType,
        targetId: schema.auditLog.targetId,
        metadata: schema.auditLog.metadata,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.actorId))
      .where(where)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(limit + 1)
      .offset(offset),
    db()
      .select({ value: count() })
      .from(schema.auditLog)
      .where(where),
  ]);

  const hasMore = rows.length > limit;
  return { rows: rows.slice(0, limit), total: totalRows[0]?.value ?? 0, hasMore };
}
