import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations, projects } from "./tenancy";

/**
 * Migadu-provisioned mailboxes used as cold-outreach sending infrastructure
 * (see `packages/migadu-client`) — one row per mailbox Falorb has created via
 * Migadu's REST management API, plus a local mirror of that mailbox's
 * traffic (`emailMessages` below).
 *
 * Unlike `integrationConnections`, this is not a credential to *reach*
 * Migadu's management API — that lives in `integrations.ts` as the
 * `migadu` provider, one per org/project. A mailbox row here is a resource
 * *provisioned through* that connection, with its own SMTP/IMAP login
 * (`encryptedPassword`), the same "different secret, different lifecycle"
 * split `ugc.ts` draws between an org's ElevenLabs connection and the videos
 * generated through it.
 *
 * `projectId` is an optional tag, same convention as `ugcVideos.projectId` —
 * which property a mailbox is used for, not an ownership scope.
 */

export const emailAccountStatusEnum = pgEnum("email_account_status", ["active", "error", "archived"]);
export const emailDirectionEnum = pgEnum("email_direction", ["inbound", "outbound"]);

export const emailAccounts = pgTable(
  "email_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),

    domain: text("domain").notNull(),
    localPart: text("local_part").notNull(),
    /** `localPart@domain`, kept denormalized so every read site doesn't rebuild it. */
    address: text("address").notNull(),
    /** Display name for the "From" header — Migadu's own mailbox `name` field. */
    name: text("name"),

    /** AES-256-GCM ciphertext of the mailbox's SMTP/IMAP password, hex-encoded
     * — same scheme as `integrationConnections`, but its own encryption call:
     * this secret authenticates to Migadu's mail servers directly, not to
     * Migadu's management API, and has its own lifecycle (rotated by
     * recreating the mailbox, not by reconnecting an integration). */
    encryptedPassword: text("encrypted_password").notNull(),
    passwordIv: text("password_iv").notNull(),
    passwordAuthTag: text("password_auth_tag").notNull(),
    passwordKeyVersion: integer("password_key_version").notNull().default(1),

    /** IMAP `UIDVALIDITY` for `INBOX` as of the last poll. Null on a mailbox
     * never polled. A value that no longer matches the live server means the
     * mailbox was renumbered — `packages/migadu-client`'s `fetchNewMessages`
     * treats that the same as "never polled": prior UIDs are meaningless. */
    imapUidValidity: integer("imap_uid_validity"),
    /** High-water mark: the highest IMAP UID already synced. Deliberately not
     * backfilled to 0 on a brand-new mailbox — see `fetchNewMessages` — so
     * the first poll adopts whatever is already the mailbox's current UID
     * rather than importing its full history. */
    imapLastUid: integer("imap_last_uid").notNull().default(0),

    status: emailAccountStatusEnum("status").notNull().default("active"),
    lastError: text("last_error"),
    /** Set by `migadu-sync` on a completed poll — the connection-health signal the Email page shows. */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("email_accounts_org_address_uq").on(t.organizationId, t.address),
    index("email_accounts_org_idx").on(t.organizationId),
    index("email_accounts_project_idx").on(t.projectId),
  ],
);

/**
 * A local mirror of each mailbox's traffic: inbound messages pulled by
 * `apps/worker/src/jobs/migadu-sync.ts`'s IMAP poll, outbound messages
 * written directly by `composeEmail` (`apps/web/src/server/actions/email.ts`)
 * at send time — Migadu's Sent folder is never polled, so an outbound row's
 * existence here *is* the record of having sent it.
 *
 * `imapUid` is therefore only ever set on inbound rows; the partial unique
 * index below dedupes a mailbox's inbound sync against itself without
 * constraining outbound rows, which have no IMAP UID to key on.
 */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    emailAccountId: uuid("email_account_id")
      .notNull()
      .references(() => emailAccounts.id, { onDelete: "cascade" }),

    direction: emailDirectionEnum("direction").notNull(),
    imapUid: integer("imap_uid"),
    /** RFC `Message-ID` header — used for reply threading (`inReplyTo` on the next message in a thread). */
    messageId: text("message_id"),
    inReplyTo: text("in_reply_to"),

    fromAddress: text("from_address"),
    fromName: text("from_name"),
    toAddresses: jsonb("to_addresses").$type<string[]>(),
    ccAddresses: jsonb("cc_addresses").$type<string[]>(),
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),

    /** IMAP `INTERNALDATE` for inbound; send time for outbound. */
    receivedAt: timestamp("received_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_messages_account_uid_uq")
      .on(t.emailAccountId, t.imapUid)
      .where(sql`${t.imapUid} is not null`),
    index("email_messages_account_idx").on(t.emailAccountId),
    index("email_messages_org_idx").on(t.organizationId),
  ],
);
