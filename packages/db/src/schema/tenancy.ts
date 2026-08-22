import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "member", "viewer"]);

/**
 * Identity scope decides how far a person is unified.
 *
 * `project` — the person exists only within one site. Safe default.
 * `org`     — the person is unified across every project in the organization
 *             that also opts in. This is what makes "which of my other
 *             products has this person used" answerable across your portfolio.
 *
 * Unification only ever happens through a *deterministic* signal: the same
 * `identify()` id on both projects, or a decorated cross-domain link click.
 * Anonymous visitors are never joined across domains — doing that would need
 * fingerprinting, which this system does not implement.
 */
export const identityScopeEnum = pgEnum("identity_scope", ["project", "org"]);

/** How the tracker behaves before a visitor has answered a consent prompt. */
export const consentModeEnum = pgEnum("consent_mode", [
  "off", // collect immediately (legitimate-interest / cookieless setups)
  "opt_in", // collect nothing until consent is granted
  "opt_out", // collect until consent is withdrawn
]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Weekly summary of all four AI signals, emailed by the digest worker job. */
    weeklyDigestEnabled: boolean("weekly_digest_enabled").notNull().default(true),
    /**
     * The workspace-wide kill switch for AI employees. Non-null means paused:
     * no agent shift is enqueued or executed and no approved action is
     * carried out until it is cleared. Queued work stays queued rather than
     * being dropped — pausing is "stop the line", not "throw away the shift".
     *
     * A timestamp rather than a boolean so the dashboard can say *how long*
     * automation has been stopped; a workspace that was paused for a quick
     * look and forgotten for a month is its own kind of outage.
     */
    automationPausedAt: timestamp("automation_paused_at", { withTimezone: true }),
    automationPausedBy: text("automation_paused_by").references(() => user.id, {
      onDelete: "set null",
    }),
    /**
     * Where to tell people an agent is waiting on a decision, in addition to
     * the owners' and admins' email. Points at an `alert_channels` row
     * (Slack, webhook or email); null means email only. Not a foreign key —
     * `ops.ts` imports this file, so the reference would be circular — and
     * checked at use, where a deleted channel simply means "email only".
     */
    approvalNotifyChannelId: uuid("approval_notify_channel_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    /**
     * Integer, not UUID, on purpose. This is the leading column of the
     * ClickHouse `events` ORDER BY key; a UInt32 keeps that index dense and
     * every query's primary-key prefix cheap.
     */
    id: serial("id").primaryKey(),
    /** Stable public identifier used in dashboard URLs. */
    uuid: uuid("uuid").notNull().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),

    /**
     * Hosts allowed to submit events for this project. Ingest rejects batches
     * whose Origin is not listed, so a leaked public key cannot be used to
     * poison another site's data.
     */
    domains: text("domains").array().notNull().default([]),

    /**
     * Optional subdomain the owner points at this app via CNAME so referral
     * links (`/r/<code>`) resolve on the property's own domain instead of the
     * shared Falorb app domain — e.g. `go.acme.example`. Null until the owner
     * configures and DNS-verifies one; unset referral links fall back to
     * `FALORB_APP_URL`.
     */
    linkDomain: text("link_domain"),

    /**
     * Secret token gating the public `/waitlist/[token]` join widget. Null
     * (the default) means the waitlist is off — same on/off-by-presence
     * convention as `dashboards.publicToken`.
     */
    waitlistToken: text("waitlist_token"),

    /** Embedded in the tracker snippet. Public by design. */
    publicKey: text("public_key").notNull(),
    /** SHA-256 of the server-side API secret. The secret itself is shown once. */
    secretKeyHash: text("secret_key_hash"),

    /** IANA timezone that "today" is computed against in reports. */
    timezone: text("timezone").notNull().default("UTC"),
    identityScope: identityScopeEnum("identity_scope").notNull().default("project"),
    consentMode: consentModeEnum("consent_mode").notNull().default("off"),

    /**
     * When true the tracker stores no cookie and no localStorage entry, and
     * identity is a daily-rotating salted hash instead. Avoids a consent
     * banner in most EU cases; the tradeoff is that anonymous visitors are
     * not recognisable across day boundaries.
     */
    cookieless: integer("cookieless").notNull().default(0),

    /** Days of raw event retention. Enforced by the retention-gc worker. */
    retentionDays: integer("retention_days").notNull().default(760),

    /** Free-form per-project config: excluded paths, PII masking rules, goals. */
    settings: jsonb("settings").notNull().default({}),

    /**
     * What this property actually is, crawled from its own homepage and
     * summarized by AI — the prospecting counterpart to `companies`'s web
     * research (`apps/web/src/server/company-research.ts`). Reddit/Hacker
     * News/job-posting listening otherwise only has a bare project name to
     * reason with; this gives relevance scoring and outreach drafts a real
     * answer to "what does this product do, who is it for, and what's worth
     * listening for." Populated by the `property-profiler` worker job (on
     * first crawl after onboarding, and again once stale) or the manual
     * "Re-crawl" action on the property's Settings page — never blocks
     * project creation itself, since a crawl needs a reachable domain and an
     * organization-connected Exa/Firecrawl provider, neither guaranteed at
     * creation time.
     */
    profileSummary: text("profile_summary"),
    /** Ideal customer profile / target audience, one or two sentences. */
    profileIcp: text("profile_icp"),
    /** Key features or value props actually stated on the homepage. */
    profileKeyFeatures: text("profile_key_features").array().notNull().default([]),
    /**
     * AI-suggested prospecting keywords derived from the crawl — pain
     * points, category terms, competitor names, buyer job titles. Surfaced
     * as suggestions on the property's "Prospecting keywords" card; never
     * auto-added to `prospect_keywords`, same manual-confirmation posture as
     * every other AI suggestion in this app.
     */
    profileSuggestedKeywords: text("profile_suggested_keywords").array().notNull().default([]),
    /** Full parsed research payload, mirrors `companies.raw`. */
    profileRaw: jsonb("profile_raw").notNull().default({}),
    profileCrawledAt: timestamp("profile_crawled_at", { withTimezone: true }),
    /** Set when a crawl attempt failed, so the sweep does not re-request
     * (and re-bill) the same failure every run — mirrors
     * `prospects.enrichmentFailedAt`. */
    profileCrawlFailedAt: timestamp("profile_crawl_failed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("projects_public_key_uq").on(t.publicKey),
    uniqueIndex("projects_uuid_uq").on(t.uuid),
    uniqueIndex("projects_org_slug_uq").on(t.organizationId, t.slug),
    uniqueIndex("projects_link_domain_uq").on(t.linkDomain),
    uniqueIndex("projects_waitlist_token_uq").on(t.waitlistToken),
    index("projects_org_idx").on(t.organizationId),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 of the key. The plaintext is displayed exactly once at creation. */
    keyHash: text("key_hash").notNull(),
    /** Short non-secret prefix so a key is recognisable in the UI. */
    keyPrefix: text("key_prefix").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    index("api_keys_org_idx").on(t.organizationId),
  ],
);

/**
 * Pending team invitations.
 *
 * A row here is a claim, not a membership — it only becomes one when the
 * invited person accepts while signed in as the invited address. Storing the
 * token as a hash means a leaked database does not hand out workspace access,
 * the same reasoning as `api_keys`.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("member"),
    /** SHA-256 of the invite token; the plaintext only ever exists in the email. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_org_idx").on(t.organizationId),
    index("invitations_email_idx").on(t.email),
  ],
);
