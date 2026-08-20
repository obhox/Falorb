import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { createClickHouse } from "@falorb/db";
import { ChWriter } from "./ch-writer";
import { createContext, refreshProjects } from "./context";
import { Scheduler, Watermarks } from "./scheduler";
import { resolveIdentities } from "./jobs/identity-resolver";
import { sessionize } from "./jobs/sessionizer";
import { optimizeAggregates, rebuildPathTransitions, refreshSegmentCounts } from "./jobs/rollups";
import { enrichCompanies } from "./jobs/enrichment";
import { listenReddit } from "./jobs/reddit-listener";
import { enrichProspectsViaClay } from "./jobs/clay-enrichment";
import { scoreInterests } from "./jobs/interest-scorer";
import { evaluateAlerts } from "./jobs/alerts";
import { dispatchWebhooks, reviveWebhooks } from "./jobs/webhooks";
import { enforceRetention, processDataRequests, pruneOrphanedPersons } from "./jobs/retention-gc";
import { sendWeeklyDigests } from "./jobs/digest";

/**
 * Worker entrypoint.
 *
 * Two independent concerns run in one process:
 *
 *   The ch-writer, which is a continuous stream consumer and must never stop —
 *   it is the path events take from Redis into ClickHouse.
 *
 *   The scheduler, which runs periodic derivation jobs. Each holds a Redis
 *   lock while running, so scaling to a second replica adds throughput to the
 *   writer without running every sweep twice.
 */

const instanceId = `${process.env.HOSTNAME ?? "worker"}-${randomUUID().slice(0, 8)}`;

const context = await createContext();
const watermarks = new Watermarks(context.redis);

// A dedicated connection for the writer: XREADGROUP blocks, and sharing that
// connection would stall every other Redis command in the process.
const streamRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", {
  maxRetriesPerRequest: null,
});
streamRedis.on("error", (e) => console.error("[redis:stream]", e.message));

const writerClickhouse = createClickHouse();
const writer = new ChWriter(streamRedis, writerClickhouse, { consumerName: instanceId });

const scheduler = new Scheduler(context.redis, instanceId);

const MINUTE = 60_000;

scheduler.add({
  name: "projects-refresh",
  intervalMs: 5 * MINUTE,
  run: () => refreshProjects(context),
});

scheduler.add({
  name: "identity-resolver",
  intervalMs: MINUTE,
  timeoutMs: 5 * MINUTE,
  run: async () => {
    await resolveIdentities({
      db: context.db,
      clickhouse: context.clickhouse,
      watermarks,
      projectOrgs: context.projectOrgs,
      orgScopedProjects: context.orgScopedProjects,
    });
  },
});

scheduler.add({
  name: "sessionizer",
  intervalMs: 5 * MINUTE,
  timeoutMs: 10 * MINUTE,
  run: async () => {
    await sessionize(context, watermarks);
  },
});

scheduler.add({
  name: "path-transitions",
  intervalMs: 15 * MINUTE,
  timeoutMs: 10 * MINUTE,
  run: () => rebuildPathTransitions(context),
});

scheduler.add({
  name: "segment-counts",
  intervalMs: 30 * MINUTE,
  timeoutMs: 10 * MINUTE,
  run: () => refreshSegmentCounts(context),
});

scheduler.add({
  name: "interest-scorer",
  intervalMs: 60 * MINUTE,
  timeoutMs: 30 * MINUTE,
  run: async () => {
    await scoreInterests(context, watermarks);
  },
});

scheduler.add({
  name: "enrichment",
  intervalMs: 6 * 60 * MINUTE,
  timeoutMs: 30 * MINUTE,
  run: async () => {
    await enrichCompanies(context, watermarks);
  },
});

scheduler.add({
  name: "reddit-listener",
  intervalMs: 15 * MINUTE,
  timeoutMs: 10 * MINUTE,
  run: async () => {
    await listenReddit(context, watermarks);
  },
});

scheduler.add({
  name: "clay-enrichment",
  intervalMs: 30 * MINUTE,
  timeoutMs: 15 * MINUTE,
  run: async () => {
    await enrichProspectsViaClay(context);
  },
});

scheduler.add({
  name: "alerts",
  intervalMs: 5 * MINUTE,
  timeoutMs: 5 * MINUTE,
  run: async () => {
    await evaluateAlerts(context);
  },
});

scheduler.add({
  name: "webhooks",
  intervalMs: MINUTE,
  timeoutMs: 5 * MINUTE,
  run: async () => {
    await dispatchWebhooks(context, watermarks);
  },
});

scheduler.add({
  name: "webhook-revive",
  intervalMs: 6 * 60 * MINUTE,
  timeoutMs: 5 * MINUTE,
  skipOnBoot: true,
  run: async () => {
    await reviveWebhooks(context);
  },
});

scheduler.add({
  name: "data-requests",
  intervalMs: 2 * MINUTE,
  timeoutMs: 30 * MINUTE,
  run: async () => {
    await processDataRequests(context);
  },
});

// Housekeeping runs rarely and is skipped at boot: a restart loop should not
// repeatedly kick off deletes and table optimizations.
scheduler.add({
  name: "retention",
  intervalMs: 12 * 60 * MINUTE,
  timeoutMs: 60 * MINUTE,
  skipOnBoot: true,
  run: async () => {
    await enforceRetention(context);
    const pruned = await pruneOrphanedPersons(context);
    if (pruned) console.log(`[retention] pruned ${pruned} orphaned profiles`);
  },
});

scheduler.add({
  name: "optimize",
  intervalMs: 6 * 60 * MINUTE,
  timeoutMs: 30 * MINUTE,
  skipOnBoot: true,
  run: () => optimizeAggregates(context),
});

// Weekly, and skipped at boot for the same reason as retention/optimize
// above: a restart should not immediately blast every org's inboxes.
scheduler.add({
  name: "digest",
  intervalMs: 7 * 24 * 60 * MINUTE,
  timeoutMs: 10 * MINUTE,
  skipOnBoot: true,
  run: async () => {
    await sendWeeklyDigests(context);
  },
});

// Reclaim stream entries orphaned by a writer that died before acknowledging.
const reclaimTimer = setInterval(() => {
  void writer.reclaimStale().catch((e) => console.error("[reclaim]", String(e)));
}, MINUTE);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${signal} received, draining...`);

  clearInterval(reclaimTimer);
  scheduler.stop();
  writer.stop();

  // Give the writer's in-flight flush time to complete before tearing down the
  // connections it needs to acknowledge with.
  await new Promise((r) => setTimeout(r, 3000));

  await Promise.allSettled([
    writerClickhouse.close(),
    context.clickhouse.close(),
  ]);
  streamRedis.disconnect();
  context.redis.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  `[worker] ${instanceId} started — ${context.projectIds.length} active projects, ${16} scheduled jobs`,
);

await writer.start();
