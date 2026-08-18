import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, projects } from "./tenancy";

/**
 * Persons live in Postgres, not ClickHouse, because a person profile mutates
 * constantly — merges, trait updates, recomputed interest scores — and
 * ClickHouse is poor at updates. ClickHouse holds the immutable event
 * firehose; this holds the mutable profile. Queries join the two through the
 * `person_overrides` dictionary.
 *
 * Explicitly not stored here: raw IP address, and any browsing activity on
 * sites the organization does not own. Every field below is derived from
 * first-party activity on the org's own properties.
 */

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Canonical company domain — the natural key for firmographic data. */
    domain: text("domain").notNull(),
    name: text("name"),
    industry: text("industry"),
    employeeRange: text("employee_range"),
    country: text("country"),
    website: text("website"),
    linkedinUrl: text("linkedin_url"),
    /** Raw provider payload, kept so a provider change can be back-filled. */
    raw: jsonb("raw").notNull().default({}),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    /**
     * Set when the provider had no record. Prevents the enrichment worker from
     * re-requesting (and re-billing) the same miss on every visit.
     */
    lookupFailedAt: timestamp("lookup_failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("companies_domain_uq").on(t.domain)],
);

export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /**
     * Every project this person has been seen on. Denormalised from
     * `person_aliases` so the profile page can render "used Beacon, read
     * Notewell, viewed Ledgerly pricing" without a fan-out query.
     */
    projectIds: integer("project_ids").array().notNull().default([]),

    /** Stable id supplied by the site via `identify()`. Null while anonymous. */
    identifiedId: text("identified_id"),
    email: text("email"),
    name: text("name"),
    avatarUrl: text("avatar_url"),

    /** Arbitrary attributes passed to `identify()`. Merged, never replaced. */
    traits: jsonb("traits").notNull().default({}),

    /**
     * Topic -> weight, computed by the interest-scorer worker from content
     * the person actually engaged with on the org's own sites. Time-decayed,
     * so a profile reflects current rather than historical interest.
     */
    interestScores: jsonb("interest_scores").notNull().default({}),

    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),

    /** First-touch acquisition, frozen at creation — never overwritten. */
    firstChannel: text("first_channel"),
    firstSource: text("first_source"),
    firstReferrerHost: text("first_referrer_host"),
    firstUtmCampaign: text("first_utm_campaign"),
    firstLandingPath: text("first_landing_path"),
    /** Referral-program code, frozen at first sighting like the fields above. */
    firstReferralCode: text("first_referral_code"),

    /** Last-touch acquisition, updated on every new session. */
    lastChannel: text("last_channel"),
    lastSource: text("last_source"),

    /** Most recent observed context, for the profile header. */
    lastCountry: text("last_country"),
    lastRegion: text("last_region"),
    lastCity: text("last_city"),
    lastDeviceType: text("last_device_type"),
    lastBrowser: text("last_browser"),
    lastOs: text("last_os"),

    totalSessions: integer("total_sessions").notNull().default(0),
    totalEvents: bigint("total_events", { mode: "number" }).notNull().default(0),
    totalPageviews: bigint("total_pageviews", { mode: "number" }).notNull().default(0),
    totalRevenue: numeric("total_revenue", { precision: 18, scale: 4 }).notNull().default("0"),

    /** Heuristic engagement score surfaced in the people list. */
    leadScore: integer("lead_score").notNull().default(0),

    /**
     * Set when the person exercises a GDPR erasure request. The row is
     * tombstoned rather than deleted so that re-ingesting the same distinct_id
     * cannot silently resurrect the profile.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("persons_org_idx").on(t.organizationId),
    index("persons_org_last_seen_idx").on(t.organizationId, t.lastSeenAt),
    index("persons_email_idx").on(t.organizationId, t.email),
    index("persons_company_idx").on(t.companyId),
    uniqueIndex("persons_org_identified_uq").on(t.organizationId, t.identifiedId),
  ],
);

/**
 * The identity graph itself: one row per (project, distinct_id) the person has
 * ever been seen as. Merging two persons rewrites these rows to point at the
 * survivor, which is what makes an anonymous visitor's earlier history appear
 * on the profile the moment they log in.
 */
export const personAliases = pgTable(
  "person_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** A device id, or an id supplied via `identify()`. */
    distinctId: text("distinct_id").notNull(),
    /** How this alias was established — used to audit and reverse bad merges. */
    kind: text("kind").notNull().default("device"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The uniqueness that makes resolution deterministic: within a project, a
    // distinct_id maps to exactly one person.
    uniqueIndex("person_aliases_project_distinct_uq").on(t.projectId, t.distinctId),
    index("person_aliases_person_idx").on(t.personId),
  ],
);

export const mergeReasonEnum = pgEnum("merge_reason", [
  "identify", // same identify() id seen on both sides
  "cross_domain_link", // arrived via a decorated link from a sibling domain
  "manual", // merged by an operator in the dashboard
]);

/** Append-only audit of every merge, so an incorrect one can be reversed. */
export const personMerges = pgTable(
  "person_merges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    survivorId: uuid("survivor_id").notNull(),
    mergedId: uuid("merged_id").notNull(),
    reason: mergeReasonEnum("reason").notNull(),
    /** Snapshot of the absorbed profile, enough to reconstruct it if reversed. */
    mergedSnapshot: jsonb("merged_snapshot").notNull().default({}),
    aliasCount: integer("alias_count").notNull().default(0),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("person_merges_survivor_idx").on(t.survivorId),
    index("person_merges_org_idx").on(t.organizationId),
  ],
);

/** Record of consent decisions, retained as the lawful-basis paper trail. */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    distinctId: text("distinct_id").notNull(),
    granted: integer("granted").notNull(),
    /** Which consent-banner version produced this decision. */
    policyVersion: text("policy_version"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consent_project_distinct_idx").on(t.projectId, t.distinctId)],
);

/** Queue of GDPR export/erasure requests, drained by the retention-gc worker. */
export const dataRequests = pgTable(
  "data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id"),
    kind: text("kind").notNull(), // "export" | "delete"
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by"),
    resultUrl: text("result_url"),
    error: text("error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("data_requests_status_idx").on(t.status)],
);
