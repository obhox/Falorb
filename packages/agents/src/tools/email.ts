import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, decryptCredential, schema } from "@falorb/db";
import { sendMail } from "@falorb/migadu-client";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * The agent's own mailbox.
 *
 * An agent with `agents.emailAccountId` set has a real address — `zoe@…` —
 * that it alone sends from and that a customer can reply to. That is the
 * difference between an SDR who *drafts* outreach for someone else to
 * paste, and one who is actually reachable. Every tool here is pinned to
 * that one mailbox: there is no `accountId` argument, because a colleague
 * does not pick which of the company's mailboxes to write from. If the
 * agent has no mailbox, every tool says so and tells it to hand the job to
 * a person — it does not fall back to a shared address.
 *
 * `send_email` is `external`, so under `assisted` it queues for approval
 * like any other action that reaches a real person; `actOnIntegrations` is
 * the same capability `composeEmail` checks for a human, so a `viewer`
 * agent never sees the tool at all. `read_inbox` reads the local mirror
 * that `migadu-sync` keeps — the same rows the Email page shows — so an
 * agent and its manager are always looking at the same thread.
 */

const MAX_BODY = 6000;

async function ownMailbox(ctx: AgentContext) {
  if (!ctx.agent.emailAccountId) {
    throw new Error(
      "You do not have a mailbox. Ask a manager to give you one from your agent page, or hand this to a person.",
    );
  }
  const [account] = await ctx.db
    .select()
    .from(schema.emailAccounts)
    .where(
      and(
        eq(schema.emailAccounts.id, ctx.agent.emailAccountId),
        eq(schema.emailAccounts.organizationId, ctx.organizationId),
        eq(schema.emailAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (!account) {
    throw new Error("Your mailbox is archived or in an error state. Hand this to a person.");
  }
  return account;
}

export const emailTools: AnyToolDefinition[] = [
  defineTool({
    name: "read_inbox",
    toolkit: "email",
    description:
      "The most recent messages in your own mailbox, inbound and outbound, newest first. " +
      "Read this before replying to anyone so you see what has already been said, and use a " +
      "message's messageId as inReplyTo on send_email to keep the thread together.",
    input: z.object({
      limit: z.number().int().min(1).max(50).default(20),
      direction: z.enum(["inbound", "outbound", "all"]).default("all"),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Read ${a.direction === "all" ? "" : a.direction + " "}inbox (${a.limit})`,
    execute: async (ctx, a) => {
      const account = await ownMailbox(ctx);
      const rows = await ctx.db
        .select({
          id: schema.emailMessages.id,
          direction: schema.emailMessages.direction,
          messageId: schema.emailMessages.messageId,
          inReplyTo: schema.emailMessages.inReplyTo,
          from: schema.emailMessages.fromAddress,
          fromName: schema.emailMessages.fromName,
          to: schema.emailMessages.toAddresses,
          subject: schema.emailMessages.subject,
          text: schema.emailMessages.textBody,
          receivedAt: schema.emailMessages.receivedAt,
        })
        .from(schema.emailMessages)
        .where(
          and(
            eq(schema.emailMessages.emailAccountId, account.id),
            a.direction === "all" ? undefined : eq(schema.emailMessages.direction, a.direction),
          ),
        )
        .orderBy(desc(schema.emailMessages.receivedAt))
        .limit(a.limit);
      return {
        address: account.address,
        messages: rows.map((r) => ({ ...r, text: r.text?.slice(0, 2000) ?? null })),
      };
    },
  }),

  defineTool({
    name: "send_email",
    toolkit: "email",
    description:
      "Send a real email from your own mailbox to one person. This reaches someone outside the " +
      "business, so write it as yourself, to a specific person, about something specific — " +
      "never a template, never a batch. Pass inReplyTo (the Message-ID from read_inbox) when " +
      "replying so it threads in their client. Never write to anyone on the suppression list.",
    input: z.object({
      to: z.string().email(),
      subject: z.string().min(1).max(200),
      text: z.string().min(1).max(MAX_BODY).describe("Plain-text body, signed as yourself."),
      inReplyTo: z.string().optional(),
      reason: z.string().min(1).describe("One line on why this person, why now — read by whoever approves it."),
    }),
    capability: "actOnIntegrations",
    effect: "external",
    risk: "high",
    summarize: (a) => `Email ${a.to}: “${a.subject}”`,
    execute: async (ctx, a) => {
      const account = await ownMailbox(ctx);

      // Do-not-contact is enforced here, not in the prompt — a rule that
      // only lives in a briefing is a suggestion.
      const [suppressed] = await ctx.db
        .select({ id: schema.crmSuppressions.id })
        .from(schema.crmSuppressions)
        .where(
          and(
            eq(schema.crmSuppressions.organizationId, ctx.organizationId),
            eq(schema.crmSuppressions.kind, "email"),
            eq(schema.crmSuppressions.value, a.to.toLowerCase()),
          ),
        )
        .limit(1);
      if (suppressed) throw new Error(`${a.to} has asked not to be contacted. Do not write to them.`);

      const password = decryptCredential({
        ciphertext: account.encryptedPassword,
        iv: account.passwordIv,
        authTag: account.passwordAuthTag,
      });

      const sent = await sendMail(
        { address: account.address, password },
        {
          to: a.to,
          subject: a.subject,
          text: a.text,
          inReplyTo: a.inReplyTo,
          references: a.inReplyTo ? [a.inReplyTo] : undefined,
          fromName: account.name ?? ctx.agent.name,
        },
      );

      await ctx.db.insert(schema.emailMessages).values({
        organizationId: ctx.organizationId,
        emailAccountId: account.id,
        direction: "outbound",
        messageId: sent.messageId,
        inReplyTo: a.inReplyTo ?? null,
        fromAddress: account.address,
        fromName: account.name ?? ctx.agent.name,
        toAddresses: [a.to],
        subject: a.subject,
        textBody: a.text,
        receivedAt: new Date(),
      });

      audit(ctx.db, {
        organizationId: ctx.organizationId,
        actorAgentId: ctx.agent.id,
        action: AUDIT_ACTIONS.emailSent,
        targetType: "email_message",
        targetId: sent.messageId,
        metadata: { from: account.address, to: a.to, reason: a.reason, runId: ctx.runId },
      });

      return { sent: true, from: account.address, to: a.to, messageId: sent.messageId };
    },
  }),
];
