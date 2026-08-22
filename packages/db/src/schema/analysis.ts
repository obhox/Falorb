import {
  boolean,
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
import { user } from "./auth";
import { organizations, projects } from "./tenancy";

/**
 * Saved analysis objects. Each stores a *definition*, never results — results
 * are always computed live against ClickHouse so a funnel opened today
 * reflects today's data without a refresh step.
 */

/**
 * A funnel definition. `steps` is an ordered array of
 * `{ event, filters?, label? }`, compiled at query time into ClickHouse's
 * `windowFunnel()`, which returns every step's drop-off in a single pass.
 */
export const funnels = pgTable(
  "funnels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    steps: jsonb("steps").notNull().default([]),
    /** Hours a visitor has to complete the whole funnel. */
    windowHours: integer("window_hours").notNull().default(168),
    /** Optional segment restricting who enters the funnel. */
    segmentId: uuid("segment_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("funnels_project_idx").on(t.projectId)],
);

/**
 * A reusable person filter. `definition` is a serialized boolean tree of
 * property/event/behaviour conditions, compiled to a ClickHouse WHERE clause
 * (and, for property-only segments, to a Postgres predicate over `persons`).
 */
export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Null means the segment spans every project in the organization. */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    definition: jsonb("definition").notNull().default({}),
    /** Cached size, refreshed by the rollups worker for fast list rendering. */
    cachedCount: integer("cached_count"),
    cachedAt: timestamp("cached_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("segments_org_idx").on(t.organizationId)],
);

/**
 * A conversion worth tracking. Matched either by event name or by a URL path
 * pattern, and optionally carrying revenue for attribution reporting.
 */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "event" | "path" */
    kind: text("kind").notNull().default("event"),
    /** Event name, or a path pattern supporting a trailing `*`. */
    matcher: text("matcher").notNull(),
    filters: jsonb("filters").notNull().default({}),
    /** Assumed value per conversion when the event carries no explicit revenue. */
    value: numeric("value", { precision: 18, scale: 4 }),
    currency: text("currency").notNull().default("USD"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("goals_project_idx").on(t.projectId)],
);

/**
 * A shareable acquisition link. `code` is the public slug in `/r/<code>` —
 * deliberately not a secret (unlike `dashboards.publicToken`): it is meant to
 * be printed on a business card or read out on a podcast, so it is
 * owner-chosen rather than random, and there is nothing to protect by hashing
 * it. Revocation is soft (`revokedAt` set, row kept) so a link's historical
 * performance survives it being taken out of circulation.
 */
export const referralLinks = pgTable(
  "referral_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** Null resolves to the project's primary domain at redirect time. */
    destinationUrl: text("destination_url"),
    /**
     * Optional incentive shown on the `/r/[code]` interstitial before the
     * visitor is redirected — the reason someone actually shares the link.
     * `incentiveKind` is app-validated ("discount" | "credit" | "unlock"),
     * kept as text rather than a pg enum to match `aiSignals.kind`'s
     * convention for small, UI-driven vocabularies.
     */
    incentiveKind: text("incentive_kind"),
    /** Short display value, e.g. "20% off" or "1 month free". */
    incentiveValue: text("incentive_value"),
    /** Longer copy shown on the interstitial page. */
    incentiveDescription: text("incentive_description"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("referral_links_code_uq").on(t.code),
    index("referral_links_project_idx").on(t.projectId),
  ],
);

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Null for a cross-project dashboard spanning the whole portfolio. */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Layout grid: widget id -> {x, y, w, h}. */
    layout: jsonb("layout").notNull().default({}),
    /** Non-null when the dashboard is publicly shared at a secret URL. */
    publicToken: text("public_token"),
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dashboards_org_idx").on(t.organizationId),
    uniqueIndex("dashboards_public_token_uq").on(t.publicToken),
  ],
);

/**
 * A saved query. Reused both standalone (in the insights explorer) and as a
 * dashboard widget, so a chart is defined once and can appear in many places.
 */
export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "trend" | "funnel" | "retention" | "paths" | "breakdown" | "stickiness" */
    kind: text("kind").notNull(),
    /** Full query definition: events, filters, breakdowns, interval, date range. */
    query: jsonb("query").notNull().default({}),
    visualization: jsonb("visualization").notNull().default({}),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insights_org_idx").on(t.organizationId)],
);

/**
 * A generated AI recommendation, cached rather than produced on every page
 * load — the underlying data (page performance, interest graph, and eventually
 * lead/channel data) only meaningfully changes over hours, not per request.
 * Regenerated on demand via a server action, not on a schedule.
 */
export const aiSignals = pgTable(
  "ai_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * Null for a signal that spans the whole portfolio rather than one
     * property — same reasoning as `dashboards.projectId` above. A sales
     * signal scoped to "across your portfolio" has no single project to
     * belong to; `organizationId` is what scopes it instead.
     */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    /** "content" | "sales" | "marketing" | "product" */
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    /** The date range (and any other inputs) this recommendation was generated from. */
    basedOnRange: jsonb("based_on_range").notNull().default({}),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_signals_project_kind_idx").on(t.projectId, t.kind),
    index("ai_signals_org_kind_idx").on(t.organizationId, t.kind),
  ],
);

export const dashboardWidgets = pgTable(
  "dashboard_widgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    insightId: uuid("insight_id").references(() => insights.id, { onDelete: "cascade" }),
    title: text("title"),
    /** Per-placement overrides, e.g. a shorter date range on a compact tile. */
    overrides: jsonb("overrides").notNull().default({}),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("dashboard_widgets_dashboard_idx").on(t.dashboardId)],
);

/**
 * Whether a draft has been committed to the owner's connected blog repo yet.
 * `publishing` covers the request in flight so a second click while a commit
 * is landing doesn't fire a duplicate; `failed` keeps `publishError` around
 * for the drafts page to show, and a retry just re-attempts from `failed`.
 */
export const contentDraftPublishStatusEnum = pgEnum("content_draft_publish_status", [
  "draft",
  "publishing",
  "published",
  "failed",
]);

/**
 * An AI-drafted landing/content page for a topic the Content page flagged as
 * "rising interest, thin coverage" — real visitor demand with no page
 * serving it yet. Optionally published by committing to a connected `github`
 * blog repo (see `publishContentDraft` and `blogPublishTargets`); until then
 * it's just copy for the owner to paste elsewhere.
 */
export const contentDrafts = pgTable(
  "content_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The interest-graph topic this draft was generated for. */
    topic: text("topic").notNull(),
    title: text("title").notNull(),
    metaDescription: text("meta_description").notNull(),
    /** Markdown body. */
    body: text("body").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    publishStatus: contentDraftPublishStatusEnum("publish_status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /** The file's web URL at the commit that published it, e.g. github.com/.../blob/<sha>/<path>. */
    publishedUrl: text("published_url"),
    /** The commit SHA that (re-)published this draft, shown as a link target on the drafts page. */
    publishCommitSha: text("publish_commit_sha"),
    /** Repo-relative path this draft was written to, so a re-publish targets the same file. */
    publishFilePath: text("publish_file_path"),
    publishError: text("publish_error"),
  },
  (t) => [
    index("content_drafts_project_idx").on(t.projectId),
    index("content_drafts_org_idx").on(t.organizationId),
  ],
);

/**
 * One row per waitlist signup. `referralCode` is minted for every entrant so
 * they can move up the list by inviting others; `referredByCode` records
 * whose invite they arrived through. Position is never stored — it is always
 * computed live from signup order plus referral count, so it can't drift out
 * of sync the way a cached rank would.
 */
export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    referralCode: text("referral_code").notNull(),
    referredByCode: text("referred_by_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("waitlist_entries_project_email_uq").on(t.projectId, t.email),
    uniqueIndex("waitlist_entries_referral_code_uq").on(t.referralCode),
    index("waitlist_entries_project_idx").on(t.projectId),
    index("waitlist_entries_referred_by_idx").on(t.referredByCode),
  ],
);
