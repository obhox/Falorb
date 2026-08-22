import { eq, sql } from "drizzle-orm";
import { decryptCredential, schema } from "@falorb/db";
import { fetchNewMessages, type ParsedInboundMessage } from "@falorb/migadu-client";
import type { WorkerContext } from "../context";

/**
 * Polls IMAP for each provisioned Migadu mailbox — Migadu has no webhook or
 * message-level API, so this is the only way replies to outreach sent
 * through `composeEmail` (`apps/web/src/server/actions/email.ts`) arrive.
 *
 * Unlike `buffer-sync.ts`, this iterates `emailAccounts` rows directly, not
 * `integrationConnections` — each mailbox's SMTP/IMAP login is its own
 * secret, independent of the org's Migadu *management* API key (see
 * `packages/db/src/schema/email.ts`'s module comment). One try/catch per
 * mailbox, same per-item isolation as Buffer's per-channel posts loop, so
 * one mailbox erroring (a rotated password, a suspended account) doesn't
 * stop the rest of the org's mailboxes from syncing.
 */

export async function syncMigadu(context: WorkerContext): Promise<void> {
  const accounts = await context.db
    .select()
    .from(schema.emailAccounts)
    .where(eq(schema.emailAccounts.status, "active"));

  for (const account of accounts) {
    try {
      await syncAccount(context, account);
    } catch (error) {
      console.error(`[migadu-sync] mailbox ${account.address} failed:`, String(error));
      await context.db
        .update(schema.emailAccounts)
        .set({ status: "error", lastError: String(error), updatedAt: new Date() })
        .where(eq(schema.emailAccounts.id, account.id));
    }
  }
}

async function syncAccount(
  context: WorkerContext,
  account: typeof schema.emailAccounts.$inferSelect,
): Promise<void> {
  const password = decryptCredential({
    ciphertext: account.encryptedPassword,
    iv: account.passwordIv,
    authTag: account.passwordAuthTag,
  });

  const { messages, uidValidity, lastUid } = await fetchNewMessages(
    { address: account.address, password },
    { uidValidity: account.imapUidValidity, lastUid: account.imapLastUid },
  );

  if (messages.length) await upsertInboundMessages(context, account, messages);

  await context.db
    .update(schema.emailAccounts)
    .set({
      imapUidValidity: uidValidity,
      imapLastUid: lastUid,
      lastSyncedAt: new Date(),
      status: "active",
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.emailAccounts.id, account.id));

  if (messages.length) {
    console.log(`[migadu-sync] mailbox ${account.address}: ${messages.length} new message(s)`);
  }
}

async function upsertInboundMessages(
  context: WorkerContext,
  account: typeof schema.emailAccounts.$inferSelect,
  messages: ParsedInboundMessage[],
): Promise<void> {
  await context.db
    .insert(schema.emailMessages)
    .values(
      messages.map((m) => ({
        organizationId: account.organizationId,
        emailAccountId: account.id,
        direction: "inbound" as const,
        imapUid: m.imapUid,
        messageId: m.messageId,
        inReplyTo: m.inReplyTo,
        fromAddress: m.fromAddress,
        fromName: m.fromName,
        toAddresses: m.toAddresses,
        ccAddresses: m.ccAddresses,
        subject: m.subject,
        textBody: m.textBody,
        htmlBody: m.htmlBody,
        receivedAt: m.receivedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [schema.emailMessages.emailAccountId, schema.emailMessages.imapUid],
      // Matches `email_messages_account_uid_uq`'s own partial WHERE
      // (`packages/db/src/schema/email.ts`) — Postgres requires the ON
      // CONFLICT target to name the exact index when it's partial.
      targetWhere: sql`${schema.emailMessages.imapUid} is not null`,
      // A polled UID is immutable content on Migadu's side — this only
      // exists so a re-poll of the same range (a crash between insert and
      // watermark update) is a no-op rather than a duplicate error.
      set: { syncedAt: sql`excluded.synced_at` },
    });
}
