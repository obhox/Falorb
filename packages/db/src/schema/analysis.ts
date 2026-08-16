import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
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
