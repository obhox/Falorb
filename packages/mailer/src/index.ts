import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email.
 *
 * Three transports, selected automatically in this order:
 *
 *   1. **Resend** when `RESEND_API_KEY` is set — the default for this
 *      deployment. Uses the HTTP API rather than Resend's SMTP bridge: it
 *      needs no persistent connection, returns a real error body instead of an
 *      SMTP status code, and gives back a message id worth logging.
 *   2. **SMTP** when `SMTP_HOST` is set. Kept because this is self-hosted
 *      software and somebody will want their own relay; swapping providers
 *      stays a matter of environment variables.
 *   3. **Log** when neither is configured. Sending does not throw — an install
 *      that refused to start because nobody set up email would be worse than
 *      one where password reset is temporarily unavailable, and during
 *      development the log is what you actually want. `isConfigured` lets
 *      callers tell the difference honestly.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export type TransportKind = "resend" | "smtp" | "log";

interface Transport {
  kind: TransportKind;
  send(mail: Mail, from: string): Promise<boolean>;
  verify(): Promise<{ ok: boolean; detail: string }>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

class ResendTransport implements Transport {
  readonly kind = "resend" as const;
  constructor(private apiKey: string) {}

  async send(mail: Mail, from: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html ?? htmlFromText(mail.text),
          ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        }),
      });

      if (response.ok) return true;

      // Resend's failures are almost always actionable — an unverified sending
      // domain, or a `from` that does not match it — so the body is worth
      // surfacing rather than just the status code.
      const detail = await response.text().catch(() => "");
      console.error(`[mail] Resend rejected the message (HTTP ${response.status}): ${detail}`);
      return false;
    } catch (error) {
      console.error(`[mail] Resend request failed:`, String(error));
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    try {
      // Listing domains is the cheapest authenticated call that proves the key
      // works without sending anything.
      const response = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (response.ok) return { ok: true, detail: "Resend API key is valid." };
      if (response.status === 401) return { ok: false, detail: "Resend API key was rejected." };
      return { ok: false, detail: `Resend returned HTTP ${response.status}.` };
    } catch (error) {
      return { ok: false, detail: String(error) };
    }
  }
}

class SmtpTransport implements Transport {
  readonly kind = "smtp" as const;
  private transporter: Transporter;

  constructor(
    private host: string,
    private port: number,
    secure: boolean,
    user: string,
    password: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: password } : undefined,
      // Bounded so a dead relay surfaces as an error rather than a hung
      // request holding a connection open indefinitely.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(mail: Mail, from: string): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html ?? htmlFromText(mail.text),
        replyTo: mail.replyTo,
      });
      return true;
    } catch (error) {
      console.error(`[mail] SMTP send to ${mail.to} failed:`, String(error));
      return false;
    }
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.transporter.verify();
      return { ok: true, detail: `Connected to ${this.host}:${this.port}.` };
    } catch (error) {
      return { ok: false, detail: String(error) };
    }
  }
}

class LogTransport implements Transport {
  readonly kind = "log" as const;

  async send(mail: Mail): Promise<boolean> {
    console.log(
      `[mail] no provider configured — would have sent to ${mail.to}: "${mail.subject}"\n${indent(mail.text)}`,
    );
    return true;
  }

  async verify(): Promise<{ ok: boolean; detail: string }> {
    return {
      ok: false,
      detail: "No email provider configured. Set RESEND_API_KEY, or SMTP_HOST for a custom relay.",
    };
  }
}

function selectTransport(env: NodeJS.ProcessEnv): Transport {
  if (env.RESEND_API_KEY) return new ResendTransport(env.RESEND_API_KEY);

  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT ?? 587);
    return new SmtpTransport(
      env.SMTP_HOST,
      port,
      // Implicit TLS on 465, STARTTLS elsewhere. Getting this wrong is the
      // most common cause of a hanging SMTP connection.
      env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
      env.SMTP_USER ?? "",
      env.SMTP_PASSWORD ?? "",
    );
  }

  return new LogTransport();
}

export class Mailer {
  private transport: Transport;
  private from: string;

  readonly isConfigured: boolean;
  readonly kind: TransportKind;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.transport = selectTransport(env);
    this.kind = this.transport.kind;
    this.isConfigured = this.transport.kind !== "log";
    this.from = env.EMAIL_FROM ?? env.SMTP_FROM ?? "Falorb <onboarding@resend.dev>";
  }

  send(mail: Mail): Promise<boolean> {
    return this.transport.send(mail, this.from);
  }

  /** Check the provider is reachable, for a health endpoint or setup wizard. */
  verify(): Promise<{ ok: boolean; detail: string }> {
    return this.transport.verify();
  }
}

/** Shared instance across worker jobs; constructing one per job would be wasteful. */
let sharedMailer: Mailer | undefined;
export function mailer(): Mailer {
  sharedMailer ??= new Mailer();
  return sharedMailer;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `      │ ${l}`)
    .join("\n");
}

/**
 * Minimal text→HTML. Not a template engine: these are short transactional
 * messages, and a plain readable body renders correctly in every client
 * including the ones that strip CSS.
 */
function htmlFromText(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bare URLs become links; nothing else is interpreted.
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:520px">${escaped}</div>`;
}

// --- message templates -----------------------------------------------------

export function resetPasswordMail(to: string, url: string): Mail {
  return {
    to,
    subject: "Reset your Falorb password",
    text: [
      "Someone asked to reset the password for this Falorb account.",
      "",
      url,
      "",
      "This link expires in one hour and can only be used once.",
      "If it wasn't you, ignore this email — nothing has changed.",
    ].join("\n"),
  };
}

export function verifyEmailMail(to: string, url: string): Mail {
  return {
    to,
    subject: "Confirm your email for Falorb",
    text: ["Confirm this address to finish setting up your Falorb account:", "", url].join("\n"),
  };
}

export function inviteMail(to: string, orgName: string, inviterName: string, url: string): Mail {
  return {
    to,
    subject: `${inviterName} invited you to ${orgName} on Falorb`,
    text: [
      `${inviterName} has invited you to join the "${orgName}" workspace on Falorb.`,
      "",
      url,
      "",
      "This invitation expires in 7 days.",
    ].join("\n"),
  };
}

export function alertMail(to: string, alertName: string, message: string, url?: string): Mail {
  return {
    to,
    subject: `Falorb alert: ${alertName}`,
    text: [message, ...(url ? ["", url] : [])].join("\n"),
  };
}

/**
 * "An agent is waiting on you." One mail per workspace per sweep, listing
 * everything newly queued, rather than one per request — a shift that
 * proposes five outreach messages should produce one email, not five.
 */
export function approvalsMail(
  to: string,
  orgName: string,
  items: Array<{ agentName: string; title: string; risk: string; expiresAt: Date }>,
  url?: string,
): Mail {
  const n = items.length;
  const lines = items.map(
    (i) =>
      `• ${i.agentName}: ${i.title} (${i.risk} risk, expires ${i.expiresAt
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")} UTC)`,
  );
  return {
    to,
    subject:
      n === 1
        ? `${items[0]!.agentName} is waiting on your decision`
        : `${n} agent actions are waiting on your decision`,
    text: [
      `In ${orgName}, ${n === 1 ? "an agent has" : `${n} agent requests have`} been queued for approval. ` +
        "Nothing happens until someone decides; undecided requests expire.",
      "",
      ...lines,
      ...(url ? ["", `Review them: ${url}`] : []),
    ].join("\n"),
  };
}

export function digestMail(
  to: string,
  sections: Array<{
    projectName: string;
    content?: string;
    sales?: string;
    marketing?: string;
    product?: string;
  }>,
): Mail {
  const body = sections.flatMap((section) => [
    section.projectName,
    ...(section.content ? [`Content: ${section.content}`] : []),
    ...(section.sales ? [`Sales: ${section.sales}`] : []),
    ...(section.marketing ? [`Marketing: ${section.marketing}`] : []),
    ...(section.product ? [`Product: ${section.product}`] : []),
    "",
  ]);

  return {
    to,
    subject: "Your weekly Falorb digest",
    text: [
      "This week's AI growth signals across your properties, regenerated so you don't have to open the dashboard to check them yourself.",
      "",
      ...body,
    ].join("\n"),
  };
}
