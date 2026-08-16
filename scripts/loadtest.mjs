#!/usr/bin/env node
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

/**
 * Find a project to send events as.
 *
 * Queries `DATABASE_URL` directly rather than shelling out to
 * `docker compose exec psql`. That worked locally and failed in CI, where the
 * databases are GitHub Actions service containers rather than a compose stack
 * — there is no compose project to exec into, and no `psql` on the runner. The
 * connection string is set in both environments, so using it is the one path
 * that works everywhere.
 */
async function project() {
  if (process.env.FALORB_PROJECT_KEY) {
    return {
      key: process.env.FALORB_PROJECT_KEY,
      origin: process.env.FALORB_ORIGIN ?? "https://obhox.com",
    };
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set DATABASE_URL, or pass FALORB_PROJECT_KEY and FALORB_ORIGIN.");
  }

  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const rows = await sql`
      SELECT public_key, domains FROM projects
      WHERE archived_at IS NULL AND array_length(domains, 1) > 0
      ORDER BY id LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      throw new Error(
        "No project with configured domains. Run `pnpm --filter @falorb/db seed`.",
      );
    }
    // The collector authorises by Origin against the project's domain list, so
    // the test has to present one — it is simulating a browser, and a request
    // with no Origin is now only accepted by projects that explicitly opt into
    // server-side ingestion.
    return { key: row.public_key, origin: `https://${row.domains[0]}` };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const { key: KEY, origin: ORIGIN } = await project();
const batches = Math.ceil(TOTAL / BATCH_SIZE);

console.log(`\nLoad test: ${TOTAL} events in ${batches} batches, concurrency ${CONCURRENCY}`);
console.log(`Run marker: ${RUN_ID}  as ${ORIGIN}\n`);

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
  // The collector refuses any request it cannot attribute to a client address,
  // and it reads that from X-Forwarded-For because it is designed to sit behind
  // a proxy (Caddy in infra/Caddyfile, Coolify's in production). Talking to it
  // directly without this header gets a 429 on every request — so the test
  // presents one, as the proxy would.
  //
  // A distinct address per worker also keeps a large run from tripping the
  // per-IP ceiling, which is a real limit rather than something to bypass.
  const clientIp = `203.0.113.${(startIndex % 254) + 1}`;

  for (let i = startIndex; i < batches; i += CONCURRENCY) {
    const began = performance.now();
    try {
      const response = await fetch(`${INGEST}/e`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Origin: ORIGIN,
          "X-Forwarded-For": clientIp,
        },
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
// Guarded: when the collector is unreachable every request throws before it is
// timed, leaving this empty. Indexing it then produced a TypeError that buried
// the actual problem — "cannot read properties of undefined" instead of
// "nothing was accepted".
const percentile = (p) =>
  latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : 0;

console.log(`  sent      ${sent}`);
console.log(`  accepted  ${accepted}`);
console.log(`  rejected  ${rejected}`);
console.log(`  duration  ${elapsed.toFixed(2)}s  (${Math.round(sent / elapsed)} events/s)`);
if (latencies.length) {
  console.log(
    `  latency   p50 ${percentile(0.5).toFixed(1)}ms  p95 ${percentile(0.95).toFixed(1)}ms  p99 ${percentile(0.99).toFixed(1)}ms`,
  );
}

// Fail here rather than waiting out the drain poll: if nothing was accepted the
// collector is down, and forty seconds of polling an empty table only delays a
// verdict that is already known.
if (accepted === 0) {
  console.error(
    `\n✗ the collector accepted nothing. Is it running at ${INGEST}?\n` +
      `  Start it with: pnpm --filter @falorb/ingest start`,
  );
  process.exit(1);
}

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
