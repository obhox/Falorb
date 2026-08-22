import { createHmac } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { goalCondition, type GoalDefinition } from "@falorb/queries";
import { UnsafeUrlError } from "@falorb/core";
import { chDateTime, schema, type WorkerContext } from "../context";
import { postWebhook } from "../net";
import type { Watermarks } from "../scheduler";

/**
 * Outbound webhook delivery.
 *
 * Fires when a goal converts, so a signup or purchase can trigger something
 * downstream — a CRM record, a Slack message, a provisioning job — without
 * anyone polling the API.
 *
 * Delivery is at-least-once. Every payload carries a stable `id`, and
 * receivers are expected to deduplicate on it; guaranteeing exactly-once over
 * HTTP to an endpoint we do not control is not achievable, and pretending
 * otherwise would just mean dropping events on ambiguous failures.
 *
 * Delivery goes through `postWebhook`, not a bare `fetch`. This job used to
 * call `fetch(hook.url, …)` directly — with redirect following left on its
 * default — while the alert-channel job next door used the hardened helper.
 * That asymmetry was the whole vulnerability: a destination screened once at
 * save time can be repointed at 127.0.0.1 an hour later, and a public host can
 * 302 into the private range, so only a check immediately before the socket
 * opens actually holds. `postWebhook` re-resolves every hop and walks
 * redirects by hand.
 */

const WATERMARK = "webhooks";
const TIMEOUT_MS = 10_000;
const MAX_FAILURES = 20;

interface ConversionRow {
  project_id: number;
  person_id: string;
  event_id: string;
  name: string;
  path: string;
  url: string;
  timestamp: string;
  revenue: string | null;
  currency: string;
  channel: string;
  source: string;
  country: string;
  props_raw: string;
}

export async function dispatchWebhooks(
  context: WorkerContext,
  watermarks: Watermarks,
): Promise<number> {
  const hooks = await context.db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.active, true));

  if (!hooks.length) return 0;

  const since = await watermarks.get(WATERMARK, 3_600_000);
  const now = Date.now();

  // Goals are the trigger vocabulary: a webhook subscribes to goal names
  // rather than raw event names, so renaming an underlying event does not
  // silently break every integration.
  const goals = await context.db.select().from(schema.goals).where(eq(schema.goals.active, true));
  if (!goals.length) {
    await watermarks.set(WATERMARK, now);
    return 0;
  }

  let delivered = 0;

  for (const hook of hooks) {
    const projectIds = hook.projectId ? [hook.projectId] : context.projectIds;
    if (!projectIds.length) continue;

    const subscribed = goals.filter(
      (g) =>
        projectIds.includes(g.projectId) &&
        (hook.triggers.length === 0 || hook.triggers.includes(g.name)),
    );
    if (!subscribed.length) continue;

    for (const goal of subscribed) {
      try {
        const conversions = await findConversions(context, goal, since, now);
        for (const conversion of conversions) {
          const ok = await deliver(context, hook, goal, conversion);
          if (ok) delivered++;
        }
      } catch (error) {
        console.error(`[webhooks] goal ${goal.name} failed:`, String(error));
      }
    }
  }

  await watermarks.set(WATERMARK, now);
  if (delivered) console.log(`[webhooks] delivered ${delivered} event(s)`);
  return delivered;
}

/**
 * Conversions that arrived since the last sweep.
 *
 * Windowed on `ingested_at`, like every other watermark-driven job — an event
 * whose client timestamp is older than its arrival must still fire its hook.
 */
async function findConversions(
  context: WorkerContext,
  goal: typeof schema.goals.$inferSelect,
  since: number,
  now: number,
): Promise<ConversionRow[]> {
  const params: Record<string, unknown> = {
    projectId: goal.projectId,
    from: chDateTime(since).slice(0, 19),
    to: chDateTime(now).slice(0, 19),
  };

  const definition: GoalDefinition = {
    id: goal.id,
    name: goal.name,
    kind: goal.kind === "path" ? "path" : "event",
    matcher: goal.matcher,
  };
  const condition = goalCondition(definition, 0, params);

  const result = await context.clickhouse.query({
    query: `
      SELECT
          project_id,
          toString(person_id) AS person_id,
          toString(event_id)  AS event_id,
          name,
          path,
          url,
          timestamp,
          revenue,
          currency,
          channel,
          source,
          country,
          props_raw
      FROM events_v
      WHERE project_id = {projectId:UInt32}
        AND ingested_at >= {from:DateTime}
        AND ingested_at < {to:DateTime}
        AND is_bot = 0
        AND ${condition}
      ORDER BY timestamp ASC
      LIMIT 500
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  return result.json<ConversionRow>();
}

async function deliver(
  context: WorkerContext,
  hook: typeof schema.webhooks.$inferSelect,
  goal: typeof schema.goals.$inferSelect,
  conversion: ConversionRow,
): Promise<boolean> {
  const payload = {
    // Stable and derived from the event, so a redelivery carries the same id
    // and the receiver can deduplicate.
    id: conversion.event_id,
    type: "goal.converted",
    goal: { id: goal.id, name: goal.name },
    project: { id: conversion.project_id },
    person: { id: conversion.person_id },
    occurredAt: conversion.timestamp,
    properties: safeParse(conversion.props_raw),
    context: {
      url: conversion.url,
      path: conversion.path,
      event: conversion.name,
      channel: conversion.channel,
      source: conversion.source,
      country: conversion.country,
      revenue: conversion.revenue ? Number(conversion.revenue) : (Number(goal.value) || null),
      currency: conversion.currency || goal.currency,
    },
  };

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  // Signed over `timestamp.body` rather than the body alone, so a captured
  // delivery cannot be replayed indefinitely — the receiver can reject a stale
  // timestamp and the signature still covers it.
  const signature = createHmac("sha256", hook.secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  try {
    const response = await postWebhook(hook.url, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Falorb-Webhook/1",
        "X-Falorb-Event": payload.type,
        "X-Falorb-Delivery": payload.id,
        "X-Falorb-Timestamp": String(timestamp),
        "X-Falorb-Signature": `v1=${signature}`,
      },
      body,
      // Conversion receivers are ordinary application endpoints and are
      // routinely slower than an alert channel's chat webhook, so this job
      // keeps the longer budget it always had.
      timeoutMs: TIMEOUT_MS,
    });

    if (response.ok) {
      await context.db
        .update(schema.webhooks)
        .set({ lastDeliveryAt: new Date(), failureCount: 0 })
        .where(eq(schema.webhooks.id, hook.id));
      return true;
    }

    await recordFailure(context, hook, `HTTP ${response.status}`);
    return false;
  } catch (error) {
    // A destination that has started resolving privately counts as a failure
    // like any other, so `recordFailure` eventually disables the hook rather
    // than the worker retrying a refused request every minute forever. The
    // reason is recorded verbatim, because "resolves to 127.0.0.1" is the one
    // failure whose cause is not obvious from the outside.
    const reason = error instanceof UnsafeUrlError ? `Unsafe destination: ${error.message}` : String(error);
    await recordFailure(context, hook, reason);
    return false;
  }
}

/**
 * Count a failure and disable the hook once it is clearly dead.
 *
 * An endpoint that has rejected twenty consecutive deliveries is not coming
 * back on its own, and continuing to call it every minute wastes the worker's
 * time and looks like an attack from the receiver's side.
 */
async function recordFailure(
  context: WorkerContext,
  hook: typeof schema.webhooks.$inferSelect,
  reason: string,
): Promise<void> {
  const failures = hook.failureCount + 1;
  await context.db
    .update(schema.webhooks)
    .set({
      failureCount: failures,
      active: failures < MAX_FAILURES,
    })
    .where(eq(schema.webhooks.id, hook.id));

  if (failures >= MAX_FAILURES) {
    console.warn(`[webhooks] disabling ${hook.url} after ${failures} failures (${reason})`);
  }
}

function safeParse(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Re-enable hooks that were disabled a while ago.
 *
 * A permanently disabled integration with no way back requires someone to
 * notice and intervene; a daily retry costs one request and recovers the
 * common case where the receiver was simply down for a deploy.
 */
export async function reviveWebhooks(context: WorkerContext): Promise<number> {
  const cutoff = new Date(Date.now() - 86_400_000);
  const revived = await context.db
    .update(schema.webhooks)
    .set({ active: true, failureCount: 0 })
    .where(
      and(
        eq(schema.webhooks.active, false),
        sql`${schema.webhooks.failureCount} >= ${MAX_FAILURES}`,
        lt(schema.webhooks.lastDeliveryAt, cutoff),
      ),
    )
    .returning();

  if (revived.length) console.log(`[webhooks] re-enabled ${revived.length} hook(s) for retry`);
  return revived.length;
}
