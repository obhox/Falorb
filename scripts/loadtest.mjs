#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * End-to-end load test with a zero-loss assertion.
 *
 * Throughput alone is not the interesting number. The claim this pipeline
 * makes is that an event accepted with a 204 is an event that reaches
 * ClickHouse — through the Redis stream, the consumer group, and a batched
 * insert. This fires a known number of events with unique markers and then
 * counts how many actually landed.
 *
 * Written in plain Node rather than k6 so it runs in CI with no extra binary
 * to install, and so the assertion can query ClickHouse directly rather than
 * inferring success from HTTP status codes.
 *
 *   node scripts/loadtest.mjs --events 5000 --concurrency 50
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const TOTAL = flag("events", 2000);
const CONCURRENCY = flag("concurrency", 20);
const BATCH_SIZE = flag("batch", 10);

const INGEST = process.env.FALORB_INGEST_URL ?? "http://localhost:3001";
const CH = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_AUTH =
  "Basic " +
  Buffer.from(
    `${process.env.CLICKHOUSE_USER ?? "falorb"}:${process.env.CLICKHOUSE_PASSWORD ?? "falorb"}`,
  ).toString("base64");
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? "falorb";

/** Unique to this run, so a re-run cannot count a previous run's events. */
const RUN_ID = randomUUID().slice(0, 8);

async function clickhouse(query) {
  const response = await fetch(`${CH}/?database=${CH_DB}`, {
    method: "POST",
    headers: { Authorization: CH_AUTH },
    body: query,
  });
  if (!response.ok) throw new Error(`ClickHouse: ${await response.text()}`);
  return (await response.text()).trim();
}

async function projectKey() {
  if (process.env.FALORB_PROJECT_KEY) return process.env.FALORB_PROJECT_KEY;
  const psql = spawn("docker", [
    "compose", "-f", "infra/docker-compose.yml", "exec", "-T", "postgres",
    "psql", "-U", "falorb", "-d", "falorb", "-t", "-A",
    "-c", "SELECT public_key FROM projects ORDER BY id LIMIT 1",
  ]);
  let out = "";
  psql.stdout.on("data", (c) => (out += c));
  await new Promise((r) => psql.on("close", r));
  const key = out.trim().split("\n")[0];
  if (!key) throw new Error("No project found. Run the seed, or set FALORB_PROJECT_KEY.");
  return key;
}

const KEY = await projectKey();
const batches = Math.ceil(TOTAL / BATCH_SIZE);

console.log(`\nLoad test: ${TOTAL} events in ${batches} batches, concurrency ${CONCURRENCY}`);
console.log(`Run marker: ${RUN_ID}\n`);

let sent = 0;
let accepted = 0;
let rejected = 0;
const latencies = [];

function makeBatch(index) {
  const device = `lt-${RUN_ID}-${index % 200}`;
  const events = Array.from({ length: BATCH_SIZE }, (_, i) => ({
    n: "$pageview",
    t: Date.now() - i * 10,
    u: `https://loadtest.example/page-${(index + i) % 25}`,
    // The marker is what makes the count unambiguous.
    p: { loadtest_run: RUN_ID, seq: index * BATCH_SIZE + i },
  }));

  return JSON.stringify({
    k: KEY,
    d: device,
    s: `lt-${RUN_ID}-s${index % 200}`,
    v: "loadtest",
    e: events,
  });
}

async function worker(startIndex) {
  for (let i = startIndex; i < batches; i += CONCURRENCY) {
    const began = performance.now();
    try {
      const response = await fetch(`${INGEST}/e`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: makeBatch(i),
      });
      latencies.push(performance.now() - began);
      if (response.status === 204) {
        accepted += BATCH_SIZE;
      } else {
        rejected += BATCH_SIZE;
        if (rejected <= BATCH_SIZE) {
          console.error(`  first rejection: HTTP ${response.status}`);
        }
      }
    } catch (error) {
      rejected += BATCH_SIZE;
      if (rejected <= BATCH_SIZE) console.error(`  first failure: ${error.message}`);
    }
    sent += BATCH_SIZE;
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
const elapsed = (performance.now() - started) / 1000;

latencies.sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

console.log(`  sent      ${sent}`);
console.log(`  accepted  ${accepted}`);
console.log(`  rejected  ${rejected}`);
console.log(`  duration  ${elapsed.toFixed(2)}s  (${Math.round(sent / elapsed)} events/s)`);
console.log(`  latency   p50 ${percentile(0.5).toFixed(1)}ms  p95 ${percentile(0.95).toFixed(1)}ms  p99 ${percentile(0.99).toFixed(1)}ms`);

// The pipeline is asynchronous by design: ingest acknowledges once the event
// is durable in Redis, and the writer batches into ClickHouse on a timer. Poll
// rather than sleeping a fixed amount, so a fast machine does not wait and a
// slow one is not failed prematurely.
process.stdout.write("\n  waiting for the writer to drain");
let landed = 0;
for (let attempt = 0; attempt < 40; attempt++) {
  await new Promise((r) => setTimeout(r, 1000));
  landed = Number(
    await clickhouse(
      `SELECT count() FROM events WHERE props_str['loadtest_run'] = '${RUN_ID}'`,
    ),
  );
  process.stdout.write(".");
  if (landed >= accepted) break;
}
console.log("");

const loss = accepted - landed;
console.log(`\n  accepted by ingest   ${accepted}`);
console.log(`  landed in ClickHouse ${landed}`);

if (rejected > 0) {
  console.error(`\n✗ ${rejected} events were rejected by the collector.`);
  process.exit(1);
}
if (loss !== 0) {
  // A negative loss means duplicates, which the at-least-once stream can
  // legitimately produce after a retry — but not during a clean run.
  console.error(
    loss > 0
      ? `\n✗ ${loss} events were acknowledged but never stored.`
      : `\n✗ ${-loss} more events stored than acknowledged (duplicates).`,
  );
  process.exit(1);
}

console.log(`\n✓ zero loss: every acknowledged event reached ClickHouse.\n`);

// Leave nothing behind, so repeated runs do not inflate the dataset.
await clickhouse(`DELETE FROM events WHERE props_str['loadtest_run'] = '${RUN_ID}'`);
process.exit(0);
