# Falorb

Self-hosted, first-party product analytics for a portfolio of sites. Built for
small-to-medium traffic, person-level detail, and one view across every project.

**Status:** backend, workers and data layer are complete and verified. The
dashboard UI is not built yet.

## What it does

- **Multi-project** — one deployment, one identity graph, every property in one place.
- **Person-level** — full timeline per visitor, across every product they've touched.
- **Cross-project identity** — answers "which of my other products has this person used".
- **Drop-off** — funnels with per-step loss, exit-rate ranking, page-to-page flows, rage clicks.
- **Enrichment** — acquisition chains, on-site interest profiles, B2B company identification.
- **Privacy-first** — no raw IP stored anywhere, GDPR export/erasure, per-project retention.

### Scope boundary

Cross-site tracking of sites you do not own is **not implemented and will not
be**. It requires third-party cookies (dead in modern browsers), persistent
fingerprinting, or purchased data-broker profiles, and is unlawful under
GDPR/ePrivacy without consent. Everything here derives from first-party
activity on properties you operate.

Anonymous visitors are never joined across domains. Identity unifies only on a
deterministic signal: the same `identify()` id on both projects, or a click
through a decorated link between two of your own domains.

## Architecture

```
Browser ──▶ apps/ingest ──▶ Redis Stream ──▶ apps/worker ──┬──▶ ClickHouse   (events)
            (Bun + Hono)                                   └──▶ Postgres     (profiles)
            p99 <10ms                                              ▲
                                          packages/queries ────────┘
```

Events are immutable and high-volume, so they live in ClickHouse. Person
profiles mutate constantly (merges, traits, interest scores), so they live in
Postgres. Redis sits between ingest and storage so a slow or restarting
ClickHouse never becomes a slow response on someone's website.

| Package | Purpose |
|---|---|
| `packages/core` | Wire format, event schema, UA/referrer/URL parsing |
| `packages/tracker` | Browser script — 2.9 KB gzip, zero dependencies |
| `packages/db` | Drizzle (Postgres) + ClickHouse DDL, migrations, API keys |
| `packages/queries` | Parameterized ClickHouse query builders |
| `apps/ingest` | Collector: validate, enrich, hash IP, publish |
| `apps/worker` | Stream writer + 11 scheduled derivation jobs |

## Getting started

```bash
pnpm install
cp .env.example .env          # then set FALORB_SALT_SECRET
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @falorb/db migrate      # Postgres
pnpm --filter @falorb/db ch:migrate   # ClickHouse
pnpm --filter @falorb/db seed         # organization + projects
pnpm --filter @falorb/tracker build
```

Run the services:

```bash
bun apps/ingest/src/index.ts
```

```bash
npx tsx apps/worker/src/index.ts
```

Install on a site:

```html
<script defer src="https://a.obhox.com/t.js" data-project="prj_..."></script>
```

```js
falorb.identify(user.id, { email: user.email, plan: user.plan })
falorb.track('checkout_started', { plan: 'pro', seats: 3 })
falorb.revenue(99, 'USD')
```

## Workers

Eleven scheduled jobs, each holding a Redis lock so a second replica adds
throughput without duplicating sweeps.

| Job | Every | Does |
|---|---|---|
| `ch-writer` | continuous | Drains the Redis stream into ClickHouse; ACKs only after the insert is confirmed |
| `identity-resolver` | 1m | Processes `$identify`, merges people, writes `person_overrides` |
| `sessionizer` | 5m | Rolls closed sessions into Postgres profiles, freezes first-touch attribution |
| `path-transitions` | 15m | Rebuilds page-to-page flows (needs `lagInFrame`, so cannot be a materialized view) |
| `segment-counts` | 30m | Caches saved-segment sizes |
| `interest-scorer` | 1h | Rarity-weighted, time-decayed topic interest per person |
| `enrichment` | 6h | Resolves ASN → company for B2B identification |
| `alerts` | 5m | Threshold, anomaly, no-data and error-spike rules |
| `data-requests` | 2m | GDPR export and erasure |
| `retention` | 12h | Per-project retention, orphan pruning |
| `optimize` | 6h | Forces aggregate merges |

Run them all once, against live data:

```bash
npx tsx apps/worker/src/verify-jobs.ts
node scripts/loadtest.mjs --events 3000    # asserts zero event loss
```

Backfill profiles from history (watermarks only move forward, so this is
needed after an import or a first deploy onto existing traffic):

```bash
npx tsx apps/worker/src/backfill.ts --days 90
```

## Privacy

- **No raw IP is stored anywhere.** Ingest hashes it with a daily-rotating salt
  and discards the original before an event is constructed. The hash cannot be
  correlated across days, or across projects.
- **Company identification keys on ASN, not IP.** An ASN identifies a network
  operator, not a person, so no personal data leaves the ingest process.
  Consumer ISP and hosting ASNs are filtered out explicitly.
- **Cookieless mode** stores nothing client-side; identity is a daily-rotating
  hash. Avoids a consent banner in most EU cases.
- **DNT and GPC** are respected by default.
- **Erasure cascades** across both stores and tombstones the profile, so the
  same device id cannot silently resurrect it.
- Form submissions record the form's identity only — **never field values**.

## Verification

```bash
pnpm -r typecheck              # 6 packages
pnpm -r test                   # 101 unit tests
pnpm --filter @falorb/tracker size    # fails the build over 3 KB gzip
pnpm --filter @falorb/queries smoke   # 32 queries against live ClickHouse
npx tsx apps/worker/src/verify-jobs.ts
node scripts/loadtest.mjs --events 3000    # asserts zero event loss
```

Backfill profiles from history (watermarks only move forward, so this is
needed after an import or a first deploy onto existing traffic):

```bash
npx tsx apps/worker/src/backfill.ts --days 90
```

`packages/db/src/seed-events.ts` generates a deterministic multi-day,
multi-project dataset with realistic funnel decay and cohort behaviour —
uniform random data makes every report look flat and hides real bugs.

## Things worth knowing before changing this

Each of these cost real debugging time and is easy to reintroduce.

- **Never alias an aggregate to a column name.** `any(project_id) AS project_id`
  makes ClickHouse resolve the `WHERE` reference to the alias and reject the
  query. Aggregate under a suffixed name in a subquery and rename outside.
- **`windowFunnel` rejects `DateTime64`.** Always pass `toDateTime(timestamp)`.
- **Watermarks must key on `ingested_at`, not `timestamp`.** The tracker batches
  and beacons on exit, so an event's client timestamp can be far behind its
  arrival; an event-time watermark silently steps over late arrivals.
- **`wait_for_async_insert: 0` hides insert errors.** A malformed batch returns
  200 and vanishes. Keep it at 1.
- **Aggregate states must match the aggregate's return type.**
  `sum(Decimal64(4))` widens to `Decimal(38,4)`, so the column is `Decimal128(4)`.
- **A materialized view only sees the block being inserted.** Anything needing
  the previous row of a session must be a scheduled job.
- **Use a `Map` for SQL allow-lists.** With an object literal,
  `FIELDS["__proto__"]` is truthy and passes a lookup-based check.
