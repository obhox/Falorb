"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, decryptCredential, schema } from "@falorb/db";
import { MigaduApiError, sendMail } from "@falorb/migadu-client";
import { requireSession } from "@/server/session";
import { getMigaduClient } from "@/server/integrations";
import { archiveMailbox, provisionMailbox } from "@/server/email";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Mailbox provisioning and email send/reply against Migadu — the
 * outreach-infrastructure counterpart to `social.ts`'s Buffer compose
 * action. Provisioning (`createEmailAccount`/`archiveEmailAccount`) is
 * gated `manageIntegrations`: creating or deleting a mailbox is
 * infrastructure spend on the org's Migadu plan, the same trust level as
 * connecting the credential itself. Sending (`composeEmail`) is gated
 * `actOnIntegrations`, matching `composeSocialPost` — using an
 * already-provisioned mailbox is a lower-trust act than provisioning one.
 *
 * Receiving has no action here: `apps/worker/src/jobs/migadu-sync.ts` polls
 * IMAP on a schedule and writes directly to `emailMessages`.
 */

export async function listMigaduDomains(): Promise<{ ok: true; domains: string[] } | { ok: false; message: string }> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageIntegrations", "list Migadu domains");
  if (refusal) return { ok: false, message: refusal.message ?? "You do not have permission to do that." };

  // `getMigaduClient` decrypts the stored credential and parses it into
  // `MigaduClient` — both can throw (a corrupted row, a stale
  // `INTEGRATION_CREDENTIAL_ENC_KEY`). Kept inside the same try/catch as the
  // API call below rather than left to propagate: an uncaught rejection here
  // reaches the dialog's `useEffect` as an unhandled promise rejection, which
  // leaves the domain list silently empty with no error shown at all — worse
  // than surfacing the real message.
  try {
    const client = await getMigaduClient(session.workspace.organizationId);
    if (!client) return { ok: false, message: "Migadu isn't connected. Connect it in Settings → Integrations." };

    const domains = await client.listDomains();
    return { ok: true, domains: domains.map((d) => d.name) };
  } catch (error) {
    return { ok: false, message: error instanceof MigaduApiError ? error.message : String(error) };
  }
}

export async function createEmailAccount(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageIntegrations", "create a mailbox");
  if (refusal) return refusal;

  const result = await provisionMailbox({
    organizationId: session.workspace.organizationId,
    domain: String(formData.get("domain") ?? "").trim(),
    localPart: String(formData.get("localPart") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    createdBy: session.user.id,
  });
  if (!result.ok) return result;

  revalidatePath("/email");
  return { ok: true, message: `${result.account.address} created.` };
}

export async function archiveEmailAccount(id: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageIntegrations", "delete a mailbox");
  if (refusal) return refusal;

  const result = await archiveMailbox(session.workspace.organizationId, id, session.user.id);
  if (!result.ok) return result;

  revalidatePath("/email");
  revalidatePath("/agents");
  return { ok: true, message: `${result.address} archived.` };
}

export async function composeEmail(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "actOnIntegrations", "send an email");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const accountId = String(formData.get("accountId") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();
  const inReplyTo = String(formData.get("inReplyTo") ?? "").trim() || undefined;
  if (!to) return { ok: false, message: "Enter a recipient." };
  if (!subject) return { ok: false, message: "Enter a subject." };
  if (!text) return { ok: false, message: "Write something to send." };

  const [account] = await db()
    .select()
    .from(schema.emailAccounts)
    .where(
      and(
        eq(schema.emailAccounts.id, accountId),
        eq(schema.emailAccounts.organizationId, orgId),
        eq(schema.emailAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (!account) return { ok: false, message: "Choose a mailbox to send from." };

  const password = decryptCredential({
    ciphertext: account.encryptedPassword,
    iv: account.passwordIv,
    authTag: account.passwordAuthTag,
  });

  let sent: { messageId: string };
  try {
    sent = await sendMail(
      { address: account.address, password },
      { to, subject, text, inReplyTo, references: inReplyTo ? [inReplyTo] : undefined, fromName: account.name ?? undefined },
    );
  } catch (error) {
    return { ok: false, message: `Could not send: ${error instanceof Error ? error.message : String(error)}` };
  }

  await db()
    .insert(schema.emailMessages)
    .values({
      organizationId: orgId,
      emailAccountId: account.id,
      direction: "outbound",
      messageId: sent.messageId,
      inReplyTo: inReplyTo ?? null,
      fromAddress: account.address,
      fromName: account.name,
      toAddresses: [to],
      subject,
      textBody: text,
      receivedAt: new Date(),
    });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.emailSent,
    targetType: "email_message",
    targetId: sent.messageId,
    metadata: { from: account.address, to },
  });

  revalidatePath("/email");
  return { ok: true, message: "Sent." };
}
