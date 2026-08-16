import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations, projects } from "./tenancy";

export const alertChannels = pgTable(
  "alert_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "email" | "slack" | "webhook" */
    kind: text("kind").notNull(),
    /** Destination config. Secrets (Slack/webhook URLs) are encrypted at rest. */
    config: jsonb("config").notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alert_channels_org_idx").on(t.organizationId)],
);

/**
 * A monitored condition. The alerts worker evaluates each rule on its own
 * cadence and fires through the configured channel.
 *
 * `condition` covers both threshold rules ("sessions today < 100") and
 * anomaly rules ("signups fell more than 40% versus the same day last week"),
 * which is what makes a traffic drop or a broken funnel visible without
 * anyone opening the dashboard.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => alertChannels.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    /** "threshold" | "anomaly" | "funnel_drop" | "error_spike" | "no_data" */
    kind: text("kind").notNull(),
    condition: jsonb("condition").notNull().default({}),
    /** Cron expression governing evaluation frequency. */
    schedule: text("schedule").notNull().default("*/15 * * * *"),
    /** Minimum gap between notifications, so a sustained breach alerts once. */
    cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
    active: boolean("active").notNull().default(true),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("alerts_org_idx").on(t.organizationId),
    index("alerts_active_idx").on(t.active),
  ],
);

/** History of every firing, so an alert's noisiness is auditable. */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    /** "fired" | "resolved" | "error" */
    status: text("status").notNull(),
    observedValue: text("observed_value"),
    expectedValue: text("expected_value"),
    message: text("message"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryError: text("delivery_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alert_events_alert_idx").on(t.alertId, t.createdAt)],
);

/** Outbound webhooks fired on analytics events, e.g. a goal conversion. */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Event names that trigger delivery. */
    triggers: text("triggers").array().notNull().default([]),
    /** HMAC signing secret, so the receiver can verify authenticity. */
    secret: text("secret").notNull(),
    active: boolean("active").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhooks_org_idx").on(t.organizationId)],
);

/** Append-only record of privileged actions in the dashboard. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_created_idx").on(t.organizationId, t.createdAt)],
);
