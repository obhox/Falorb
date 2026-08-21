import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations, projects } from "./tenancy";
import { user } from "./auth";
import { persons } from "./persons";

/**
 * The other side of the boundary `persons.ts` draws: a person or account
 * discovered talking about the org's product somewhere the org does not own
 * (Reddit today). Everything here originates on a public, third-party
 * platform and is speculative until enriched — a prospect is a lead to
 * investigate, not a verified identity the way a `person` with a first-party
 * `identify()` call is.
 *
 * Deliberately its own table rather than a `persons` row with no site
 * history: `persons`'s stated contract explicitly excludes exactly this kind
 * of data, and most of its columns (totalSessions, interestScores, leadScore)
 * are meaningless for someone who has never visited an owned property.
 */
export const prospects = pgTable(
  "prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The project whose keyword list surfaced this mention. Nullable so a
     * prospect (and any enrichment already paid for) survives the project
     * being deleted. */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),

    /** "reddit" today. Open text, not an enum — mirrors `person_aliases.kind`
     * and `alert_channels.kind` — because another listening source is a new
     * value, not a schema migration. */
    source: text("source").notNull(),
    /** Natural id from the source (e.g. Reddit's fullname, "t3_xxx"/"t1_xxx"). */
    sourceId: text("source_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    /** "post" | "comment" */
    sourceType: text("source_type").notNull(),
    authorHandle: text("author_handle"),
    title: text("title"),
    /** Truncated snippet, shown on the dashboard and fed to the outreach
     * prompt so neither needs to re-fetch the source. */
    excerpt: text("excerpt").notNull(),
    matchedKeywords: text("matched_keywords").array().notNull().default([]),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /** Full source payload, mirrors `companies.raw`. */
    raw: jsonb("raw").notNull().default({}),

    /** AI relevance pass, run at discovery time. Null if scoring failed —
     * a scoring failure must never drop the underlying discovery. */
    relevanceScore: integer("relevance_score"),
    relevanceRationale: text("relevance_rationale"),

    /** Contact-enrichment cache, same shape and reasoning as `companies`. */
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactTitle: text("contact_title"),
    contactLinkedinUrl: text("contact_linkedin_url"),
    contactCompanyDomain: text("contact_company_domain"),
    enrichmentRaw: jsonb("enrichment_raw").notNull().default({}),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    /** Set when the provider had no record, so the enrichment worker does not
     * re-request (and re-bill) the same miss on every sweep. */
    enrichmentFailedAt: timestamp("enrichment_failed_at", { withTimezone: true }),

    /** "new" | "enriching" | "enriched" | "contacted" | "dismissed" — plain
     * text, UI-driven vocabulary, same style as `ai_signals`/`alert_rules`. */
    status: text("status").notNull().default("new"),
    /** Owner-set outreach marker, same reasoning as `persons.contactedAt`. */
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    contactedBy: text("contacted_by").references(() => user.id, { onDelete: "set null" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),

    /** Set only by a human-confirmed merge into an existing on-site profile
     * — e.g. the prospect later signs up and is recognised as the same
     * person. Never written automatically. */
    personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Two orgs may both legitimately store the same public Reddit post.
    uniqueIndex("prospects_org_source_uq").on(t.organizationId, t.source, t.sourceId),
    index("prospects_org_status_idx").on(t.organizationId, t.status),
    index("prospects_org_created_idx").on(t.organizationId, t.createdAt),
    index("prospects_project_idx").on(t.projectId),
    index("prospects_person_idx").on(t.personId),
  ],
);

/**
 * A keyword or phrase to watch for on a listening source, scoped to one
 * project — matches `goals`/`referral_links`'s project-scoping, even though
 * the dashboard that consumes matches is org-wide (see the web app's
 * `/prospecting` route). This table is config, not the aggregate view.
 */
export const prospectKeywords = pgTable(
  "prospect_keywords",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("prospect_keywords_project_keyword_uq").on(t.projectId, t.keyword),
    index("prospect_keywords_project_idx").on(t.projectId),
  ],
);
