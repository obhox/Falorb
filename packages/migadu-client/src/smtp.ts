import nodemailer from "nodemailer";

/**
 * Sending, over Migadu's fixed SMTP relay — every mailbox on every domain
 * Migadu hosts uses the same host/port, only the mailbox credential differs.
 * Same `nodemailer` transport shape as `packages/mailer`'s `SmtpTransport`,
 * but built fresh per call with a per-mailbox credential rather than one
 * deployment-wide relay held open as a singleton.
 */

const MIGADU_SMTP_HOST = "smtp.migadu.com";
const MIGADU_SMTP_PORT = 465;
const TIMEOUT_MS = 20_000;

export interface MigaduMailboxCredential {
  address: string;
  password: string;
}

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Set when this is a reply, so the recipient's client threads it — the `Message-ID` this responds to. */
  inReplyTo?: string;
  /** Full `References` chain for the same reason; falls back to `inReplyTo` alone when omitted. */
  references?: string[];
  fromName?: string;
}

export async function sendMail(
  mailbox: MigaduMailboxCredential,
  mail: OutboundMail,
): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: MIGADU_SMTP_HOST,
    port: MIGADU_SMTP_PORT,
    secure: true,
    auth: { user: mailbox.address, pass: mailbox.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  const info = await transporter.sendMail({
    from: mail.fromName ? `${mail.fromName} <${mailbox.address}>` : mailbox.address,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    replyTo: mail.replyTo,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
  });

  return { messageId: info.messageId };
}
