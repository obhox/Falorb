import { createHmac } from "node:crypto";
import { Mailer, alertMail } from "@falorb/mailer";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { totals, type DateRange } from "@falorb/queries";
import { schema, type WorkerContext } from "../context";
import { postWebhook } from "../net";

/**
 * Alert evaluation and delivery.
 *
 * The point of these is that the interesting events happen while nobody is
 * looking at the dashboard: traffic collapsing because a deploy broke the
 * tracker, a funnel silently failing, an error spike after a release.
 */

interface ThresholdCondition {
  metric: "visitors" | "sessions" | "pageviews" | "events" | "revenue";
  operator: "lt" | "lte" | "gt" | "gte";
  value: number;
  windowMinutes?: number;
}

interface AnomalyCondition {
  metric: ThresholdCondition["metric"];
  /** Percentage change that counts as an anomaly, e.g. 40 for -40%. */
  changePercent: number;
  direction: "drop" | "rise" | "either";
  windowMinutes?: number;
  /** How far back the comparison window sits, default one week. */
  compareOffsetMinutes?: number;
}

export async function evaluateAlerts(context: WorkerContext): Promise<number> {
  const now = Date.now();

  const rules = await context.db
    .select()
    .from(schema.alerts)
    .where(
      and(
        eq(schema.alerts.active, true),
        // Respect the cooldown so a sustained breach notifies once rather than
        // on every evaluation tick.
        or(
          isNull(schema.alerts.lastFiredAt),
          sql`${schema.alerts.lastFiredAt} < now() - (${schema.alerts.cooldownMinutes} || ' minutes')::interval`,
        ),
      ),
    );

  if (!rules.length) return 0;

  let fired = 0;
  for (const rule of rules) {
    try {
      const outcome = await evaluate(context, rule, now);
      await context.db
        .update(schema.alerts)
        .set({ lastEvaluatedAt: new Date(now) })
        .where(eq(schema.alerts.id, rule.id));

      if (!outcome) continue;

      await context.db.insert(schema.alertEvents).values({
        alertId: rule.id,
        status: "fired",
        observedValue: String(outcome.observed),
        expectedValue: String(outcome.expected),
        message: outcome.message,
      });

      await context.db
        .update(schema.alerts)
        .set({ lastFiredAt: new Date(now) })
        .where(eq(schema.alerts.id, rule.id));

      await deliver(context, rule, outcome.message);
      fired++;
    } catch (error) {
      console.error(`[alerts] rule ${rule.id} failed:`, String(error));
      await context.db.insert(schema.alertEvents).values({
        alertId: rule.id,
        status: "error",
        message: String(error).slice(0, 500),
      });
    }
  }

  if (fired) console.log(`[alerts] ${fired} of ${rules.length} rules fired`);
  return fired;
}

interface Outcome {
  observed: number;
  expected: number;
  message: string;
}

async function evaluate(
  context: WorkerContext,
  rule: typeof schema.alerts.$inferSelect,
  now: number,
): Promise<Outcome | null> {
  const projectIds = rule.projectId ? [rule.projectId] : context.projectIds;
  if (!projectIds.length) return null;

  switch (rule.kind) {
    case "threshold":
      return evaluateThreshold(context, rule, projectIds, now);
    case "anomaly":
      return evaluateAnomaly(context, rule, projectIds, now);
    case "no_data":
      return evaluateNoData(context, rule, projectIds, now);
    case "error_spike":
      return evaluateErrorSpike(context, rule, projectIds, now);
    default:
      return null;
  }
}

async function metricValue(
  context: WorkerContext,
  projectIds: number[],
  metric: ThresholdCondition["metric"],
  range: DateRange,
): Promise<number> {
  const row = await totals(context.clickhouse, { projectIds, range });
  return Number(row[metric] ?? 0);
}

async function evaluateThreshold(
  context: WorkerContext,
  rule: typeof schema.alerts.$inferSelect,
  projectIds: number[],
  now: number,
): Promise<Outcome | null> {
  const c = rule.condition as unknown as ThresholdCondition;
  const windowMs = (c.windowMinutes ?? 60) * 60_000;
  const observed = await metricValue(context, projectIds, c.metric, {
    from: now - windowMs,
    to: now,
  });

  const breached =
    (c.operator === "lt" && observed < c.value) ||
    (c.operator === "lte" && observed <= c.value) ||
    (c.operator === "gt" && observed > c.value) ||
    (c.operator === "gte" && observed >= c.value);

  if (!breached) return null;
  return {
    observed,
    expected: c.value,
    message: `${rule.name}: ${c.metric} was ${observed} over the last ${c.windowMinutes ?? 60}m (threshold ${c.operator} ${c.value})`,
  };
}

/**
 * Compare the current window against the same window one period earlier.
 *
 * Comparing to "one week ago" rather than "the previous hour" by default,
 * because almost all web traffic has a strong weekly shape — a Sunday
 * afternoon is legitimately quieter than a Tuesday morning, and comparing
 * adjacent windows would alert on that every week.
 */
async function evaluateAnomaly(
  context: WorkerContext,
  rule: typeof schema.alerts.$inferSelect,
  projectIds: number[],
  now: number,
): Promise<Outcome | null> {
  const c = rule.condition as unknown as AnomalyCondition;
  const windowMs = (c.windowMinutes ?? 60) * 60_000;
  const offsetMs = (c.compareOffsetMinutes ?? 7 * 24 * 60) * 60_000;

  const observed = await metricValue(context, projectIds, c.metric, {
    from: now - windowMs,
    to: now,
  });
  const baseline = await metricValue(context, projectIds, c.metric, {
    from: now - offsetMs - windowMs,
    to: now - offsetMs,
  });

  // A near-zero baseline makes percentage change meaningless and would fire on
  // the first visitor of a quiet project.
  if (baseline < 5) return null;

  const change = ((observed - baseline) / baseline) * 100;
  const magnitude = Math.abs(change);
  if (magnitude < Math.abs(c.changePercent)) return null;

  const isDrop = change < 0;
  if (c.direction === "drop" && !isDrop) return null;
  if (c.direction === "rise" && isDrop) return null;

  return {
    observed,
    expected: baseline,
    message: `${rule.name}: ${c.metric} ${isDrop ? "fell" : "rose"} ${magnitude.toFixed(1)}% (${observed} vs ${baseline} in the comparison window)`,
  };
}

/**
 * Fires when a project stops reporting entirely — the failure mode that every
 * other alert misses, because a broken tracker produces no data to threshold.
 */
async function evaluateNoData(
  context: WorkerContext,
  rule: typeof schema.alerts.$inferSelect,
  projectIds: number[],
  now: number,
): Promise<Outcome | null> {
  const c = rule.condition as unknown as { windowMinutes?: number };
  const windowMs = (c.windowMinutes ?? 60) * 60_000;

  const result = await context.clickhouse.query({
    query: `
      SELECT count() AS events
      FROM events
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND timestamp >= {from:DateTime64(3)}
    `,
    query_params: {
      projectIds,
      from: new Date(now - windowMs).toISOString().replace("T", " ").replace("Z", ""),
    },
    format: "JSONEachRow",
  });

  const [row] = await result.json<{ events: string | number }>();
  const events = Number(row?.events ?? 0);
  if (events > 0) return null;

  return {
    observed: 0,
    expected: 1,
    message: `${rule.name}: no events received in the last ${c.windowMinutes ?? 60} minutes — the tracker may be broken or blocked`,
  };
}

async function evaluateErrorSpike(
  context: WorkerContext,
  rule: typeof schema.alerts.$inferSelect,
  projectIds: number[],
  now: number,
): Promise<Outcome | null> {
  const c = rule.condition as unknown as { windowMinutes?: number; value?: number };
  const windowMs = (c.windowMinutes ?? 30) * 60_000;
  const threshold = c.value ?? 25;

  const result = await context.clickhouse.query({
    query: `
      SELECT countIf(name = '$error') AS errors
      FROM events
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND timestamp >= {from:DateTime64(3)}
        AND is_bot = 0
    `,
    query_params: {
      projectIds,
      from: new Date(now - windowMs).toISOString().replace("T", " ").replace("Z", ""),
    },
    format: "JSONEachRow",
  });

  const [row] = await result.json<{ errors: string | number }>();
  const errors = Number(row?.errors ?? 0);
  if (errors < threshold) return null;

  return {
    observed: errors,
    expected: threshold,
    message: `${rule.name}: ${errors} JavaScript errors in the last ${c.windowMinutes ?? 30}m (threshold ${threshold})`,
  };
}

/** Deliver a fired alert through its configured channel. */
async function deliver(
  context: WorkerContext,
  rule: typeof schema.alerts.$inferSelect,
  message: string,
): Promise<void> {
  if (!rule.channelId) {
    console.log(`[alerts] ${message}`);
    return;
  }

  const [channel] = await context.db
    .select()
    .from(schema.alertChannels)
    .where(eq(schema.alertChannels.id, rule.channelId))
    .limit(1);

  if (!channel?.active) return;
  const config = channel.config as Record<string, string>;

  try {
    if (channel.kind === "slack" || channel.kind === "webhook") {
      const url = config.url;
      if (!url) return;

      const body = JSON.stringify(
        channel.kind === "slack" ? { text: message } : { alert: rule.name, message },
      );

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Sign webhook deliveries so the receiver can verify they are genuine.
      if (channel.kind === "webhook" && config.secret) {
        headers["X-Falorb-Signature"] = createHmac("sha256", config.secret)
          .update(body)
          .digest("hex");
      }

      // Not a bare `fetch`. The destination is user-supplied and this call is
      // made from inside the compose network, so every hop is resolved and
      // screened against the private ranges first — see `../net`.
      const response = await postWebhook(url, { headers, body });
      await markDelivered(context, rule.id, response.ok);
    } else if (channel.kind === "email") {
      const to = config.to;
      if (!to) {
        console.warn(`[alerts] channel ${channel.id} has no recipient configured`);
        return;
      }
      const dashboard = process.env.FALORB_APP_URL;
      const sent = await mailer().send(
        alertMail(to, rule.name, message, dashboard ? `${dashboard}/alerts` : undefined),
      );
      await markDelivered(context, rule.id, sent);
    }
  } catch (error) {
    console.error(`[alerts] delivery failed for ${rule.id}:`, String(error));
  }
}

/** Shared transport; constructing one per alert would be wasteful. */
let sharedMailer: Mailer | undefined;
function mailer(): Mailer {
  sharedMailer ??= new Mailer();
  return sharedMailer;
}

/**
 * Record whether the notification actually reached its channel.
 *
 * Scoped to the most recent event for this rule — updating every historical
 * row would rewrite the delivery record of alerts that fired days ago.
 */
async function markDelivered(
  context: WorkerContext,
  alertId: string,
  ok: boolean,
): Promise<void> {
  const [latest] = await context.db
    .select({ id: schema.alertEvents.id })
    .from(schema.alertEvents)
    .where(eq(schema.alertEvents.alertId, alertId))
    .orderBy(desc(schema.alertEvents.createdAt))
    .limit(1);

  if (!latest) return;

  await context.db
    .update(schema.alertEvents)
    .set({
      deliveredAt: ok ? new Date() : null,
      deliveryError: ok ? null : "delivery failed",
    })
    .where(eq(schema.alertEvents.id, latest.id));
}
