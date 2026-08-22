import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { MigaduMailboxCredential } from "./smtp";

/**
 * Receiving, by polling `INBOX` over IMAP — Migadu has no webhook or
 * message-level API, so this is the only way in. Called from
 * `apps/worker/src/jobs/migadu-sync.ts` on a schedule, one mailbox at a time.
 *
 * Every mailbox on every domain Migadu hosts uses the same IMAP host/port;
 * only the mailbox credential differs, same as `smtp.ts`.
 */

const MIGADU_IMAP_HOST = "imap.migadu.com";
const MIGADU_IMAP_PORT = 993;
const TIMEOUT_MS = 20_000;

export interface InboundWatermark {
  /** Null on a mailbox never polled before. */
  uidValidity: number | null;
  /** Highest UID already synced, relative to `uidValidity`. */
  lastUid: number;
}

export interface ParsedInboundMessage {
  imapUid: number;
  messageId: string | null;
  inReplyTo: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  receivedAt: Date;
}

export interface FetchResult {
  messages: ParsedInboundMessage[];
  uidValidity: number;
  lastUid: number;
}

type AddressLike = { value: Array<{ address?: string }> };

/** `to`/`cc` are typed as one `AddressObject` or an array of them — a message can carry several `To` header lines. */
function addressList(value: AddressLike | AddressLike[] | undefined): string[] {
  if (!value) return [];
  const objects = Array.isArray(value) ? value : [value];
  return objects.flatMap((o) => o.value.map((a) => a.address)).filter((a): a is string => Boolean(a));
}

export async function fetchNewMessages(
  mailbox: MigaduMailboxCredential,
  watermark: InboundWatermark,
): Promise<FetchResult> {
  const client = new ImapFlow({
    host: MIGADU_IMAP_HOST,
    port: MIGADU_IMAP_PORT,
    secure: true,
    auth: { user: mailbox.address, pass: mailbox.password },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailboxInfo = client.mailbox;
      if (!mailboxInfo || typeof mailboxInfo === "boolean") {
        throw new Error("Migadu IMAP did not return mailbox status for INBOX.");
      }
      const uidValidity = Number(mailboxInfo.uidValidity);
      const uidNext = mailboxInfo.uidNext;

      // A changed (or absent) UIDVALIDITY means the server has renumbered
      // this mailbox, or this is the first poll ever. Either way, prior
      // UIDs are meaningless — and for a first poll specifically, this
      // integration deliberately does not backfill a mailbox's history (see
      // module doc on `fetchNewMessages` in the package README / plan): it
      // just adopts the current high-water mark so future polls pick up
      // only what arrives from here on.
      if (watermark.uidValidity === null || watermark.uidValidity !== uidValidity) {
        return { messages: [], uidValidity, lastUid: Math.max(0, uidNext - 1) };
      }

      if (uidNext - 1 <= watermark.lastUid) {
        return { messages: [], uidValidity, lastUid: watermark.lastUid };
      }

      const messages: ParsedInboundMessage[] = [];
      let highestUid = watermark.lastUid;

      for await (const message of client.fetch(
        { uid: `${watermark.lastUid + 1}:*` },
        { uid: true, source: true, internalDate: true },
      )) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const from = parsed.from?.value[0];
        messages.push({
          imapUid: message.uid,
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          fromAddress: from?.address ?? null,
          fromName: from?.name ?? null,
          toAddresses: addressList(parsed.to),
          ccAddresses: addressList(parsed.cc),
          subject: parsed.subject ?? null,
          textBody: parsed.text ?? null,
          htmlBody: typeof parsed.html === "string" ? parsed.html : null,
          receivedAt: message.internalDate ? new Date(message.internalDate) : new Date(),
        });
        highestUid = Math.max(highestUid, message.uid);
      }

      return { messages, uidValidity, lastUid: highestUid };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
