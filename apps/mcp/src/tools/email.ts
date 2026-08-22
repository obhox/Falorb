import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, desc, eq } from "drizzle-orm";
import { decryptCredential, encryptCredential, schema } from "@falorb/db";
import { MigaduApiError, sendMail } from "@falorb/migadu-client";
import type { McpContext } from "../context";
import { requireCapability, requireLocalOperator, requireScope, resolveProjects } from "../context";
import { getMigaduClient } from "../clients";
import { ago, failure, table, text } from "../format";

const DIRECTIONS = ["inbound", "outbound"] as const;

function randomMailboxPassword(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Email — cold-outreach mailboxes provisioned through Migadu (see
 * `packages/migadu-client`, `packages/db/src/schema/email.ts`). Unlike
 * CRM/support/social, this is not a periodic sync mirror: inbound messages
 * are written by `apps/worker/src/jobs/migadu-sync.ts`'s IMAP poll as they
 * arrive, and an outbound row's existence *is* the record of having sent it
 * (Migadu's Sent folder is never polled) — so `list_email_messages` reads
 * current state, not a snapshot that can lag by a fixed interval.
 *
 * Provisioning (`create_email_account`/`archive_email_account`) requires
 * `requireLocalOperator`, the same gate `connect_integration` uses — the
 * dashboard restricts creating or deleting a mailbox to `manageIntegrations`
 * (owner/admin), and there is no bearer-key REST route for either action at
 * all today (`apps/web/src/server/actions/email.ts` only), so a remote MCP
 * client has no path to it in the real product either. Sending
 * (`send_email`) only needs the `write` scope, matching `composeEmail`'s
 * lighter `actOnIntegrations` (member) gate and mirroring
 * `create_social_post`/`push_crm_signal` exactly.
 *
 * `send_email` authenticates with the mailbox's own stored SMTP credential
 * (`emailAccounts.encryptedPassword`), not the org's Migadu management-API
 * connection — the same split `composeEmail` uses, and why `getMigaduClient`
 * is only ever called from the two provisioning tools here.
 */
export function registerEmailTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "list_email_accounts",
    {
      title: "List email mailboxes",
      description:
        "Mailboxes provisioned through Migadu — address, status, and last IMAP sync. Optionally " +
        "filtered to one project's tagged mailboxes (a mailbox's project is a label, not an access " +
        "boundary — every mailbox in the org is visible either way).",
      inputSchema: {
        project: z.string().optional().describe("Project slug — show only mailboxes tagged to this property."),
        include_archived: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, include_archived }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.emailAccounts.organizationId, scope.organizationId)];
        if (project) conditions.push(eq(schema.emailAccounts.projectId, resolveProjects(scope, project)[0]!));
        if (!include_archived) conditions.push(eq(schema.emailAccounts.status, "active"));

        const rows = await db
          .select()
          .from(schema.emailAccounts)
          .where(and(...conditions))
          .orderBy(desc(schema.emailAccounts.createdAt));

        return text(
          table(
            rows,
            [
              { header: "Id", get: (r) => r.id },
              { header: "Address", get: (r) => r.address },
              { header: "Name", get: (r) => r.name },
              { header: "Status", get: (r) => r.status },
              { header: "Last synced", get: (r) => (r.lastSyncedAt ? ago(r.lastSyncedAt.toISOString()) : "—") },
              { header: "Last error", get: (r) => r.lastError },
            ],
            "No mailboxes provisioned yet — connect Migadu, then call create_email_account.",
          ),
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "list_email_messages",
    {
      title: "List email messages",
      description:
        "Messages across every mailbox (or one, via account_id), newest first. Inbound rows arrive " +
        "from Migadu's periodic IMAP poll; outbound rows are written the moment send_email sends " +
        "them, so a just-sent message shows up immediately, not after the next sync.",
      inputSchema: {
        account_id: z.string().uuid().optional().describe("From list_email_accounts. Omit for every mailbox."),
        direction: z.enum(DIRECTIONS).optional(),
        search: z.string().optional().describe("Match against subject, from, or to."),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ account_id, direction, search, limit }) => {
      const { db, scope } = ctx();
      try {
        const conditions = [eq(schema.emailMessages.organizationId, scope.organizationId)];
        if (account_id) conditions.push(eq(schema.emailMessages.emailAccountId, account_id));
        if (direction) conditions.push(eq(schema.emailMessages.direction, direction));

        const rows = await db
          .select()
          .from(schema.emailMessages)
          .where(and(...conditions))
          .orderBy(desc(schema.emailMessages.receivedAt))
          .limit(search ? 500 : limit);

        const filtered = search
          ? rows
              .filter((r) =>
                [r.subject, r.fromAddress, ...(r.toAddresses ?? [])].some((v) =>
                  (v ?? "").toLowerCase().includes(search.toLowerCase()),
                ),
              )
              .slice(0, limit)
          : rows;

        return text(
          table(
            filtered,
            [
              { header: "Direction", get: (r) => r.direction },
              { header: "From", get: (r) => (r.fromName ? `${r.fromName} <${r.fromAddress}>` : r.fromAddress) },
              { header: "To", get: (r) => (r.toAddresses ?? []).join(", ") },
              { header: "Subject", get: (r) => r.subject },
              { header: "Received", get: (r) => (r.receivedAt ? ago(r.receivedAt.toISOString()) : "—") },
              { header: "In reply to", get: (r) => r.inReplyTo },
            ],
            "No messages mirrored yet.",
          ) + "\n\nEach row's full body is not shown here to keep this list compact — this is metadata for finding a thread, not the message content.",
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "send_email",
    {
      title: "Send an email",
      description:
        "Send a real email from a provisioned mailbox, over Migadu's SMTP relay — a real, external " +
        "action, not a Falorb-internal one. Pass in_reply_to (the original message's Message-ID, " +
        "from list_email_messages) to thread a reply in the recipient's client. Requires the write " +
        "scope.",
      inputSchema: {
        account_id: z.string().uuid().describe("The sending mailbox, from list_email_accounts."),
        to: z.string().email(),
        subject: z.string().min(1),
        text: z.string().min(1).describe("Plain-text body."),
        in_reply_to: z.string().optional().describe("The Message-ID this replies to, for threading."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ account_id, to, subject, text: body, in_reply_to }) => {
      const { db, scope } = ctx();
      try {
        requireScope(scope, "write");
        requireCapability(scope, "actOnIntegrations", "send an email");

        const [account] = await db
          .select()
          .from(schema.emailAccounts)
          .where(
            and(
              eq(schema.emailAccounts.id, account_id),
              eq(schema.emailAccounts.organizationId, scope.organizationId),
              eq(schema.emailAccounts.status, "active"),
            ),
          )
          .limit(1);
        if (!account) return failure("No such active mailbox.");

        const password = decryptCredential({
          ciphertext: account.encryptedPassword,
          iv: account.passwordIv,
          authTag: account.passwordAuthTag,
        });

        let sent: { messageId: string };
        try {
          sent = await sendMail(
            { address: account.address, password },
            {
              to,
              subject,
              text: body,
              inReplyTo: in_reply_to,
              references: in_reply_to ? [in_reply_to] : undefined,
              fromName: account.name ?? undefined,
            },
          );
        } catch (error) {
          return failure(`Could not send: ${message(error)}`);
        }

        await db.insert(schema.emailMessages).values({
          organizationId: scope.organizationId,
          emailAccountId: account.id,
          direction: "outbound",
          messageId: sent.messageId,
          inReplyTo: in_reply_to ?? null,
          fromAddress: account.address,
          fromName: account.name,
          toAddresses: [to],
          subject,
          textBody: body,
          receivedAt: new Date(),
        });

        return text(`Sent from ${account.address} to ${to}, message id \`${sent.messageId}\`.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "create_email_account",
    {
      title: "Provision a mailbox",
      description:
        "Create a new mailbox on a domain already on the connected Migadu account. Falorb generates " +
        "and stores the mailbox password itself — nothing to pass in. Local operator only (stdio): " +
        "the dashboard gates this at owner/admin (manageIntegrations) and there is no bearer-key " +
        "route for it at all, so a remote key has no path to it in the real product either.",
      inputSchema: {
        domain: z.string().min(1).describe("Must already exist on the connected Migadu account."),
        local_part: z.string().regex(/^[a-z0-9._-]+$/, "Letters, numbers, dots, dashes and underscores only."),
        name: z.string().optional().describe("Display name for the From header. Defaults to local_part."),
        project: z.string().optional().describe("Project slug to tag this mailbox with — a label, not an access boundary."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ domain, local_part, name, project }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, "create a mailbox");
        const projectId = project ? resolveProjects(scope, project)[0]! : null;

        const client = await getMigaduClient(db, scope.organizationId);
        if (!client) return failure("Migadu isn't connected. Connect it first with connect_integration.");

        const password = randomMailboxPassword();
        let mailbox;
        try {
          mailbox = await client.createMailbox(domain, { localPart: local_part, name: name || local_part, password });
        } catch (error) {
          return failure(`Migadu rejected the mailbox: ${message(error)}`);
        }

        const encrypted = encryptCredential(password);
        await db.insert(schema.emailAccounts).values({
          organizationId: scope.organizationId,
          projectId,
          domain: mailbox.domain_name,
          localPart: mailbox.local_part,
          address: mailbox.address,
          name: mailbox.name,
          encryptedPassword: encrypted.ciphertext,
          passwordIv: encrypted.iv,
          passwordAuthTag: encrypted.authTag,
        });

        return text(`Created **${mailbox.address}**.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "archive_email_account",
    {
      title: "Archive a mailbox",
      description:
        "Delete a mailbox from Migadu and mark Falorb's record of it archived. The mailbox's " +
        "message history stays (for audit purposes); nothing more can send or arrive through it. " +
        "Local operator only (stdio) — same rule as create_email_account.",
      inputSchema: { account_id: z.string().uuid().describe("From list_email_accounts.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ account_id }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, "delete a mailbox");

        const [account] = await db
          .select()
          .from(schema.emailAccounts)
          .where(and(eq(schema.emailAccounts.id, account_id), eq(schema.emailAccounts.organizationId, scope.organizationId)))
          .limit(1);
        if (!account) return failure("No such mailbox.");

        const client = await getMigaduClient(db, scope.organizationId);
        if (client) {
          try {
            await client.deleteMailbox(account.domain, account.localPart);
          } catch (error) {
            if (!(error instanceof MigaduApiError && error.status === 404)) {
              return failure(`Migadu rejected the delete: ${message(error)}`);
            }
          }
        }

        await db
          .update(schema.emailAccounts)
          .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.emailAccounts.id, account_id));

        return text(`Archived ${account.address}.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
