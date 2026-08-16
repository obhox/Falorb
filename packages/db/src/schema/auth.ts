import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * better-auth tables. Column names are dictated by better-auth's Drizzle
 * adapter and must not be renamed.
 *
 * These describe *dashboard operators* — you and your team — not tracked
 * visitors. That is why `session.ipAddress` exists here: it is ordinary
 * admin-session security metadata for people who have accounts and have
 * agreed to terms. Tracked visitors are a different concern entirely and
 * their IP is never persisted anywhere (see `persons` and the ingest layer).
 */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    /**
     * Which workspace this account is currently looking at.
     *
     * Someone who accepts an invitation belongs to two organizations, and
     * without a stored choice `ensureWorkspace` could only ever hand back one
     * of them — whichever the ordering picked — leaving the other unreachable.
     * This is that choice.
     *
     * It carries **no foreign key**, for two reasons. `tenancy.ts` already
     * imports `user` from this file, so pointing back at `organizations` would
     * make the schema modules circular. More importantly the constraint would
     * not be earning anything: this is a preference, not a grant, and every
     * resolution re-checks that a matching membership still exists. A value
     * left dangling by a deleted organization — or by someone being removed
     * from one — finds no membership and falls back to a workspace they are
     * actually in, which is the same behaviour a `SET NULL` would produce.
     */
    activeOrganizationId: uuid("active_organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_email_uq").on(t.email)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** Active organization, so the dashboard knows the current tenant context. */
    activeOrganizationId: text("active_organization_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_token_uq").on(t.token),
    index("session_user_idx").on(t.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Argon2 hash for the email+password provider. Never a plaintext password. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("account_user_idx").on(t.userId),
    uniqueIndex("account_provider_uq").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
