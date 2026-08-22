import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, encryptCredential, schema } from "@falorb/db";
import { MigaduApiError } from "@falorb/migadu-client";
import { getMigaduClient } from "@/server/integrations";

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

/**
 * Create a mailbox on the connected Migadu account and record it — the one
 * provisioning path, shared by the Email page's "New mailbox" and by hiring
 * an agent with an address of its own. Returns a plain result rather than
 * throwing because both callers want to *report* a Migadu refusal (a domain
 * not on the account, a local part already taken) rather than crash on it.
 *
 * `localPart` is lowercased and must already be valid; callers that derive
 * one from a person's name should go through `mailboxLocalPart` first.
 */
export async function provisionMailbox(input: {
  organizationId: string;
  domain: string;
  localPart: string;
  name: string;
  createdBy: string;
  projectId?: number | null;
}): Promise<{ ok: true; account: EmailAccountRow } | { ok: false; message: string }> {
  const localPart = input.localPart.trim().toLowerCase();
  if (!input.domain) return { ok: false, message: "Choose a domain." };
  if (!/^[a-z0-9._-]+$/.test(localPart)) {
    return { ok: false, message: "Mailbox name may only contain letters, numbers, dots, dashes and underscores." };
  }

  const client = await getMigaduClient(input.organizationId);
  if (!client) return { ok: false, message: "Migadu isn't connected. Connect it in Settings → Integrations." };

  const password = randomBytes(24).toString("base64url");
  let mailbox: Awaited<ReturnType<typeof client.createMailbox>>;
  try {
    mailbox = await client.createMailbox(input.domain, { localPart, name: input.name || localPart, password });
  } catch (error) {
    return { ok: false, message: error instanceof MigaduApiError ? error.message : String(error) };
  }

  const encrypted = encryptCredential(password);
  const [row] = await db()
    .insert(schema.emailAccounts)
    .values({
      organizationId: input.organizationId,
      projectId: input.projectId ?? null,
      domain: mailbox.domain_name,
      localPart: mailbox.local_part,
      address: mailbox.address,
      name: mailbox.name,
      encryptedPassword: encrypted.ciphertext,
      passwordIv: encrypted.iv,
      passwordAuthTag: encrypted.authTag,
      createdBy: input.createdBy,
    })
    .returning();

  audit(db(), {
    organizationId: input.organizationId,
    actorId: input.createdBy,
    action: AUDIT_ACTIONS.emailAccountCreated,
    targetType: "email_account",
    targetId: row!.id,
    metadata: { address: mailbox.address },
  });

  return { ok: true, account: row! };
}

/**
 * Turn a person's name into a mailbox local part that is free in this
 * organization: "Amara" → `amara`, or `amara2` if a previous Amara — active
 * or archived, since the org/address index covers both — already took it.
 * Falls back to `agent` for a name with no usable characters at all.
 */
export async function mailboxLocalPart(organizationId: string, name: string, domain: string): Promise<string> {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 24) || "agent";
  const taken = new Set(
    (
      await db()
        .select({ localPart: schema.emailAccounts.localPart })
        .from(schema.emailAccounts)
        .where(and(eq(schema.emailAccounts.organizationId, organizationId), eq(schema.emailAccounts.domain, domain)))
    ).map((r) => r.localPart),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  return `${base}${Date.now().toString(36)}`;
}

/**
 * Archive a mailbox: delete it at Migadu, keep Falorb's row as history. A
 * 404 from Migadu (already deleted from its own dashboard) is not a failure
 * — the local record is what's being closed out. Shared by the Email page
 * and by taking a mailbox away from, or retiring, an agent.
 */
export async function archiveMailbox(
  organizationId: string,
  accountId: string,
  actorId: string,
): Promise<{ ok: true; address: string } | { ok: false; message: string }> {
  const [account] = await db()
    .select()
    .from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.id, accountId), eq(schema.emailAccounts.organizationId, organizationId)))
    .limit(1);
  if (!account) return { ok: false, message: "No such mailbox." };
  if (account.status === "archived") return { ok: true, address: account.address };

  const client = await getMigaduClient(organizationId);
  if (client) {
    try {
      await client.deleteMailbox(account.domain, account.localPart);
    } catch (error) {
      if (!(error instanceof MigaduApiError && error.status === 404)) {
        return { ok: false, message: error instanceof MigaduApiError ? error.message : String(error) };
      }
    }
  }

  await db()
    .update(schema.emailAccounts)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.emailAccounts.id, accountId));

  audit(db(), {
    organizationId,
    actorId,
    action: AUDIT_ACTIONS.emailAccountArchived,
    targetType: "email_account",
    targetId: accountId,
    metadata: { address: account.address },
  });

  return { ok: true, address: account.address };
}
