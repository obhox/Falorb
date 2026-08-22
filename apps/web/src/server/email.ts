import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * The Migadu mailbox mirror, read-side. `emailAccounts` is written by
 * `apps/web/src/server/actions/email.ts` (mailbox create/archive);
 * `emailMessages` is written there too for outbound sends, and by
 * `apps/worker/src/jobs/migadu-sync.ts`'s IMAP poll for inbound ones.
 */

export type EmailAccountRow = typeof schema.emailAccounts.$inferSelect;
export type EmailMessageRow = typeof schema.emailMessages.$inferSelect;

export async function listEmailAccounts(organizationId: string): Promise<EmailAccountRow[]> {
  return db()
    .select()
    .from(schema.emailAccounts)
    .where(eq(schema.emailAccounts.organizationId, organizationId))
    .orderBy(desc(schema.emailAccounts.createdAt))
    .limit(100);
}

export async function listEmailMessages(organizationId: string, accountId?: string): Promise<EmailMessageRow[]> {
  return db()
    .select()
    .from(schema.emailMessages)
    .where(
      and(
        eq(schema.emailMessages.organizationId, organizationId),
        accountId ? eq(schema.emailMessages.emailAccountId, accountId) : undefined,
      ),
    )
    .orderBy(desc(schema.emailMessages.receivedAt))
    .limit(500);
}

/** Org-level connection only, same convention as `isBufferConnected` — a property-only override doesn't light up this org-wide check. */
export async function isMigaduConnected(organizationId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.integrationConnections.id })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, "migadu"),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
