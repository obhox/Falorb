import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * Alert rules and their firing history.
 *
 * The condition shapes here mirror exactly what `apps/worker/src/jobs/alerts.ts`
 * reads. They are duplicated rather than imported because the worker keeps them
 * private and this is a read of the same jsonb column — if the worker's shapes
 * change, these must change with them, which is why each field carries the same
 * meaning and default as it does there.
 */

export type AlertRow = typeof schema.alerts.$inferSelect;
export type AlertEventRow = typeof schema.alertEvents.$inferSelect;

export const ALERT_KINDS = [
  "threshold",
  "anomaly",
  "no_data",
  "error_spike",
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  threshold: "Threshold",
  anomaly: "Anomaly",
  no_data: "No data",
  error_spike: "Error spike",
};

export const ALERT_METRICS = ["visitors", "sessions", "pageviews", "events", "revenue"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];

export interface ThresholdCondition {
  metric: AlertMetric;
  operator: "lt" | "lte" | "gt" | "gte";
  value: number;
  windowMinutes?: number;
}

export interface AnomalyCondition {
  metric: AlertMetric;
  changePercent: number;
  direction: "drop" | "rise" | "either";
  windowMinutes?: number;
  compareOffsetMinutes?: number;
}

export interface AlertWithHistory {
  alert: AlertRow;
  projectName: string | null;
  channelName: string | null;
  channelKind: string | null;
  recent: AlertEventRow[];
}

export type AlertChannelRow = typeof schema.alertChannels.$inferSelect;

export async function listChannels(organizationId: string): Promise<AlertChannelRow[]> {
  return db()
    .select()
    .from(schema.alertChannels)
    .where(eq(schema.alertChannels.organizationId, organizationId))
    .orderBy(schema.alertChannels.createdAt);
}

export async function listAlerts(organizationId: string): Promise<AlertWithHistory[]> {
  const database = db();

  const rows = await database
    .select({
      alert: schema.alerts,
      projectName: schema.projects.name,
      channelName: schema.alertChannels.name,
      channelKind: schema.alertChannels.kind,
    })
    .from(schema.alerts)
    // Left joins throughout: an alert with a null projectId watches the whole
    // portfolio, and one with a null channelId delivers nowhere. Inner joins
    // would hide exactly the rows worth seeing.
    .leftJoin(schema.projects, eq(schema.projects.id, schema.alerts.projectId))
    .leftJoin(schema.alertChannels, eq(schema.alertChannels.id, schema.alerts.channelId))
    .where(eq(schema.alerts.organizationId, organizationId))
    .orderBy(desc(schema.alerts.createdAt));

  if (rows.length === 0) return [];

  // One query for all history rather than one per alert.
  const events = await database
    .select()
    .from(schema.alertEvents)
    .where(inArray(schema.alertEvents.alertId, rows.map((row) => row.alert.id)))
    .orderBy(desc(schema.alertEvents.createdAt))
    .limit(200);

  const byAlert = new Map<string, AlertEventRow[]>();
  for (const event of events) {
    const list = byAlert.get(event.alertId) ?? [];
    if (list.length < 5) list.push(event);
    byAlert.set(event.alertId, list);
  }

  return rows.map((row) => ({
    alert: row.alert,
    projectName: row.projectName,
    channelName: row.channelName,
    channelKind: row.channelKind,
    recent: byAlert.get(row.alert.id) ?? [],
  }));
}

/** A one-line, human reading of a rule's condition. */
export function describeCondition(alert: AlertRow): string {
  const condition = alert.condition as Record<string, unknown>;

  switch (alert.kind) {
    case "threshold": {
      const c = condition as unknown as ThresholdCondition;
      const operator =
        c.operator === "lt"
          ? "below"
          : c.operator === "lte"
            ? "at or below"
            : c.operator === "gte"
              ? "at or above"
              : "above";
      return `${c.metric} ${operator} ${c.value} in ${c.windowMinutes ?? 60} minutes`;
    }
    case "anomaly": {
      const c = condition as unknown as AnomalyCondition;
      const direction =
        c.direction === "drop" ? "falls" : c.direction === "rise" ? "rises" : "changes";
      return `${c.metric} ${direction} more than ${c.changePercent}% versus ${
        (c.compareOffsetMinutes ?? 10080) / 1440
      } days earlier`;
    }
    case "no_data":
      return `no events for ${(condition.windowMinutes as number) ?? 60} minutes`;
    case "error_spike":
      return `${(condition.value as number) ?? 25}+ errors in ${
        (condition.windowMinutes as number) ?? 30
      } minutes`;
    default:
      return alert.kind;
  }
}
