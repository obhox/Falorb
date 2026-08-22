import { createHmac } from "node:crypto";
import { mailer, type Mail } from "@falorb/mailer";
import type { schema } from "./context";
import { postWebhook } from "./net";

/**
 * One way to reach a person through an `alert_channels` row, shared by
 * everything in the worker that has something to say to a human — analytics
 * alerts, and now an agent waiting on a decision.
 *
 * Extracted rather than duplicated because the channel kinds are going to
 * keep growing, and "Slack works for alerts but approval notices silently
 * drop" is exactly the kind of drift two copies of this produce. The
 * `agent` kind is deliberately not handled here: waking an agent is not
 * a notification, and it lives with the alerts job that owns that idea.
 */
export type Channel = typeof schema.alertChannels.$inferSelect;

export interface Notice {
  /** Slack text / email subject line. */
  title: string;
  /** Full body, plain text. */
  message: string;
  /** Where the reader should go. Appended to Slack and email. */
  url?: string;
  /** Shape of the JSON a webhook receiver gets; Slack gets `{ text }`. */
  webhookBody?: Record<string, unknown>;
}

/** Returns whether the message was accepted by the destination. */
export async function sendToChannel(channel: Channel, notice: Notice): Promise<boolean> {
  if (!channel.active) return false;
  const config = channel.config as Record<string, string>;

  if (channel.kind === "slack" || channel.kind === "webhook") {
    const url = config.url;
    if (!url) return false;

    const text = notice.url ? `${notice.message}\n${notice.url}` : notice.message;
    const body = JSON.stringify(
      channel.kind === "slack"
        ? { text }
        : (notice.webhookBody ?? { title: notice.title, message: notice.message, url: notice.url }),
    );

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // Sign webhook deliveries so the receiver can verify they are genuine.
    if (channel.kind === "webhook" && config.secret) {
      headers["X-Falorb-Signature"] = createHmac("sha256", config.secret).update(body).digest("hex");
    }

    // Not a bare `fetch`. The destination is user-supplied and this call is
    // made from inside the compose network, so every hop is resolved and
    // screened against the private ranges first — see `./net`.
    const response = await postWebhook(url, { headers, body });
    return response.ok;
  }

  if (channel.kind === "email") {
    const to = config.to;
    if (!to) {
      console.warn(`[channels] email channel ${channel.id} has no recipient configured`);
      return false;
    }
    const mail: Mail = {
      to,
      subject: notice.title,
      text: [notice.message, ...(notice.url ? ["", notice.url] : [])].join("\n"),
    };
    return mailer().send(mail);
  }

  return false;
}
