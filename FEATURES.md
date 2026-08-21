# Falorb — Feature Status

Living record of what exists, what is half-built, and what has not been started.

**Last updated:** 2026-08-20

| Status | Meaning |
|---|---|
| ✅ | Built **and verified running** — evidence noted |
| 🟡 | Partially built — the gap is stated explicitly |
| ⬜ | Not started |
| 📋 | Designed only — deliberately not implemented yet |

**Where things stand:** the collection pipeline, storage layer, identity graph,
query layer, background workers, MCP server and self-serve account system are
complete and verified. The dashboard is built — 40 routes on the Falorb design
system, light and dark, role-enforced. Most routes are driven end to end by
Playwright; the eight newest — sales lead actions, the weekly digest, the
product signal's drop-off data, the public benchmark report, the referral
incentive layer, content auto-drafting, the embeddable badge and the
referral-boosted waitlist (§14e–§14j below) — are verified manually
(typecheck, production build, and live requests against the dev stack) and
not yet in that suite. It does
not yet cover the whole backend: see *Backend surface not yet in the dashboard*.
The external-integrations layer (§13 — Linki for sales/outreach, Bund AI for
support, Clay for prospect contact enrichment) is built and typechecks clean
end to end. Clay has been connected and exercised live (§17); Linki and Bund
AI have not — no organization has connected real credentials to either yet,
so that half has not run against live data. See §13 for exactly what "built"
means here versus what is still verified. Verification commands are in
[README.md](README.md).

---

## 1. Foundation

| | Feature | Notes |
|---|---|---|
| ✅ | pnpm + Turborepo monorepo | 6 packages, TypeScript strict throughout |
| ✅ | Docker Compose stack | Postgres 17, Redis 7 (appendonly), ClickHouse 25.3 |
| ✅ | ClickHouse tuning for a shared host | Capped memory/pools, bounded system logs, `listen_host` |
| ✅ | ClickHouse migration runner | Statement splitter, `{{PLACEHOLDER}}` substitution, credential redaction on error |
| ✅ | Postgres schema + migrations | Drizzle, 25 tables |
| ✅ | Project seed | Organization + 5 projects with public keys |
| ✅ | Deterministic event generator | Seeded PRNG; realistic funnel decay and cohort behaviour |

## 2. Tracker — `packages/tracker`

**2,943 B gzip / 2,644 B brotli.** Budget gate fails the build over 3 KB.

| | Feature | Notes |
|---|---|---|
| ✅ | Pageviews, SPA-aware | Patches `pushState`/`replaceState` + `popstate` |
| ✅ | Sessions | 30-min idle timeout, shared constant with the server |
| ✅ | Outbound clicks, downloads, tagged elements | `[data-falorb]` + `data-falorb-prop-*` |
| ✅ | Form submits | Form identity only — **never field values** |
| ✅ | Scroll depth | Throttled, max-per-page |
| ✅ | Rage clicks | 3+ within 700ms in a 30px radius |
| ✅ | JS errors + unhandled rejections | |
| ✅ | Core Web Vitals | LCP, FCP, CLS, INP, TTFB — hand-rolled, ~400 B |
| ✅ | Exit beacon | On `visibilitychange`, not `unload` (Safari/mobile skip unload) |
| ✅ | Manual API | `track` `page` `identify` `group` `revenue` `reset` `consent` |
| ✅ | Pre-load queue stub | Calls before script load are not lost |
| ✅ | Transport | `sendBeacon` → `fetch(keepalive)`, batched 10 / 2s / pagehide |
| ✅ | DNT + GPC respect | Configurable |
| ✅ | Cookieless mode | Session-scoped id, no persistence |
| ✅ | Size gate in CI | `pnpm --filter @falorb/tracker size` |
| ✅ | Dead-click detection | Detected by consequence: a click on something interactive where neither the URL nor the DOM changed within 500ms |
| ⬜ | Session replay | Deliberately deferred; schema and tracker leave the extension point |

## 3. Ingest — `apps/ingest`

Verified: batch POST → **HTTP 204 in 45 ms**, events landed in ClickHouse.

| | Feature | Notes |
|---|---|---|
| ✅ | `POST /e` batch collector | Zod-validated wire format |
| ✅ | `GET /t.js` | Immutable 1-year cache |
| ✅ | `GET /health` | Reports redis / geo / tracker readiness |
| ✅ | In-memory project cache | Stale-while-revalidate; no DB hit per request |
| ✅ | Origin allow-listing | Apex domain authorises subdomains |
| ✅ | GeoIP enrichment | MaxMind in-process; degrades gracefully when absent |
| ✅ | UA parsing + bot filtering | 25+ bot signatures incl. AI crawlers |
| ✅ | Referrer / UTM classification | 12 channels, multi-part TLD handling |
| ✅ | IP hashing | Daily-rotating salt; **raw IP never stored** |
| ✅ | Rate limiting | Per daily ip_hash |
| ✅ | Clock-skew clamping | Wrong device clocks can't land in the wrong partition |
| ✅ | CORS as a simple request | `text/plain` avoids the preflight round-trip |
| ✅ | GeoIP download script | Downloads City + ASN databases, verifies and unpacks them |
| ✅ | Server-side consent enforcement | Opt-in batches without consent are refused **at the server**, not just client-side; explicit decisions are logged |

## 4. Storage

| | Feature | Notes |
|---|---|---|
| ✅ | `events` table | Monthly partitions, 25-month TTL, bloom-filter skip indexes |
| ✅ | `sessions` rollup + MV + readable view | Unpartitioned by design (sessions straddle month boundaries) |
| ✅ | `daily_stats` / `daily_paths` / `daily_sources` / `daily_geo` / `daily_tech` MVs | Narrow per-dimension rollups, not one wide table |
| ✅ | `person_daily` MV | Retention input |
| ✅ | `path_transitions` | Worker-populated (an MV cannot see the previous row) |
| ✅ | `person_overrides` + DICTIONARY + `events_v` | Read-time identity resolution |
| ✅ | Postgres control plane | Auth, tenancy, persons, analysis objects, ops |

## 5. Identity graph

Verified end to end: one person, two devices, two products, both stores agreeing.

| | Feature | Notes |
|---|---|---|
| ✅ | Deterministic person ids | Derived at ingest, no DB round-trip |
| ✅ | Retroactive merge | One small insert re-attributes entire history; no `ALTER TABLE UPDATE` |
| ✅ | Cross-project unification | Same `identify()` id across projects → one person |
| ✅ | Merge audit + snapshot | `person_merges` allows a bad merge to be reversed |
| ✅ | Alias → override consistency | Postgres and ClickHouse kept in agreement |
| ✅ | **Cross-domain link stitching** | Token validated at ingest (where the freshness window is meaningful), then stitched by the resolver. Verified: an anonymous visitor clicking acme→beacon becomes one person across both |
| ✅ | Manual merge / unmerge API | `POST /api/people/merge` and `/unmerge/:id`; reversible from the audit snapshot. Absent from MCP by design |
| ❌ | Cross-site tracking | **Out of scope permanently.** See [README](README.md#scope-boundary) |

## 6. Query layer — `packages/queries`

**All 32 verified against live ClickHouse** (`pnpm --filter @falorb/queries smoke`).

| | Feature | Notes |
|---|---|---|
| ✅ | Filter AST → parameterized SQL | Map-based allow-list; no value ever interpolated |
| ✅ | `totals` | Session-level bounce rate and duration, correctly weighted |
| ✅ | `trend` | 6 metrics, auto interval, breakdown series |
| ✅ | `breakdown` | Any dimension incl. custom properties |
| ✅ | `funnel` | `windowFunnel`, 3 ordering modes, per-step drop-off |
| ✅ | `funnelDropoffs` | **Who** abandoned at a given step |
| ✅ | `retention` + `stickiness` | Day/week/month cohorts |
| ✅ | `pathTransitions` | Sankey source |
| ✅ | `exitPages` / `entryPages` | Exit *rate* ranking with a minimum-sample guard |
| ✅ | `frustration` | Rage clicks, dead clicks, errors per page |
| ✅ | `sessionList` / `sessionEvents` / `closedSessions` | |
| ✅ | `personList` / `personTimeline` | Timeline spans every project |
| ✅ | `personProjects` | Which products this person used |
| ✅ | `acquisitionChain` | Every referrer + campaign that ever sent them |
| ✅ | `personInterests` | Topics engaged with |
| ✅ | `liveVisitors` / `liveCounts` / `liveFeed` | |
| ✅ | `portfolioOverview` / `portfolioSparklines` | With previous-period deltas |
| ✅ | `crossProjectPeople` | People who used 2+ products |
| ✅ | Goal conversions | Event- or path-matched, with conversion rate against visitors in scope |
| ✅ | Revenue attribution | first-touch / last-touch / linear; verified to produce genuinely different answers |
| ✅ | `contentInterests` | Project-level topic rollup, computed live from `events_v` rather than the cached per-person `interestScores` — the only way to respect the caller's date range and show a trend |
| ✅ | `referralClicks` | Landing-pageview clicks and visitors per referral code |
| 🟡 | Query smoke runner coverage | The two rows above are unit-tested (`interests.test.ts`, `referrals.test.ts`) and verified against real seeded data via the browser, but not yet added to `smoke.ts`'s 32-query run |

## 7. Workers — `apps/worker`

13 of the 17 below verified running via `pnpm --filter @falorb/worker verify:jobs`; `digest` typechecks and doesn't touch its siblings, but isn't in that runner yet since exercising it live sends real email and makes a real OpenRouter call. `linki-sync`, `bund-ai-sync`, and `buffer-sync` are in the runner (no-op cleanly with zero connected orgs) but have never processed a real org, since none has connected credentials yet — see §13.

| | Job | Every | Notes |
|---|---|---|---|
| ✅ | `ch-writer` | continuous | ACKs Redis only after ClickHouse confirms; reclaims stale entries |
| ✅ | `identity-resolver` | 1m | Merges, writes overrides |
| ✅ | `sessionizer` | 5m | Profile sync, first-touch freeze, lead score |
| ✅ | `path-transitions` | 15m | Rebuild via `lagInFrame` |
| ✅ | `segment-counts` | 30m | Cached segment sizes |
| ✅ | `interest-scorer` | 1h | Rarity-weighted, time-decayed |
| ✅ | `enrichment` | 6h | ASN → company |
| ✅ | `alerts` | 5m | Verified firing |
| ✅ | `data-requests` | 2m | GDPR export + erase |
| ✅ | `retention` | 12h | Per-project + orphan prune |
| ✅ | `optimize` | 6h | Forces aggregate merges |
| ✅ | `digest` | 7d, `skipOnBoot` | Regenerates all four AI signals per project and emails one summary per org to its owners/admins; opt-out per org (`organizations.weeklyDigestEnabled`, on by default) |
| 🟡 | `linki-sync` | 15m | Full paginated poll of a connected Linki workspace into `crm.*` (contacts, lists, workflows, runs, run profiles/tracks, pipeline stages, opportunities, signal rules, suppressions, sent messages), upserted on `(organizationId, linkiId)`. Typechecks, in `verify:jobs`; never run against a real Linki workspace — see §13 |
| 🟡 | `bund-ai-sync` | 15m | Same shape, into `support.*` (conversations, escalations, leads, tickets) from a connected Bund AI business. Poll-only — the inbound-webhook push half is not built; see §13 |
| 🟡 | `buffer-sync` | 15m | Full poll (cursor-paginated, not `limit`/`offset`) of a connected Buffer account into `social.*` (channels, posts + metrics), upserted on `(organizationId, bufferId)`. Typechecks, in `verify:jobs`; never run against a real Buffer account — see §13b |
| ✅ | Scheduler | — | Redis distributed locks, watermarks, overlap guard |
| ✅ | `webhooks` | 1m | Fires on goal conversion; HMAC over `timestamp.body`, auto-disables after 20 failures |
| ✅ | `webhook-revive` | 6h | Re-enables hooks disabled by a transient outage |
| ✅ | Historical backfill | manual | `apps/worker/src/backfill.ts` — assigns totals rather than incrementing, so a re-run is safe |

## 8. Privacy & compliance

| | Feature | Notes |
|---|---|---|
| ✅ | No raw IP anywhere | Hashed with daily-rotating salt, original discarded |
| ✅ | Per-project, per-day hash isolation | Hashes cannot be joined across tenants or days |
| ✅ | ASN-based company lookup | No personal data leaves ingest |
| ✅ | Consumer ISP / hosting filtering | A residential visitor is never labelled with their ISP |
| ✅ | GDPR erasure | Cascades both stores + tombstones the profile |
| ✅ | GDPR export | Full profile + event history |
| ✅ | Per-project retention | Enforced, not just declared |
| ✅ | DNT / GPC | |
| ✅ | Cookieless mode | |
| ✅ | Form values never captured | |
| ✅ | Consent-mode enforcement server-side | Enforced in ingest before any enrichment or storage |
| ✅ | PII masking | Applied at ingest to url, path, referrer, title, props **and props_raw**; per-project rules |
| ✅ | Generated privacy disclosure | `GET /api/projects/:slug/disclosure`, written from the project's real settings |

## 9. Ops & security

| | Feature | Notes |
|---|---|---|
| ✅ | API key issuance + verification | SHA-256, scopes, expiry, revocation, timing-safe compare |
| ✅ | Public key generation | |
| ✅ | HMAC webhook signing helper | |
| ✅ | Alert rules | threshold / anomaly / no_data / error_spike |
| ✅ | Slack + generic webhook delivery | |
| ✅ | Alert history + cooldown | |
| ✅ | Audit log schema | |
| ✅ | Email alert delivery | Via Resend; delivery success recorded on the alert event |
| ✅ | Audit log writing | Project, key, member and person actions; secret-shaped fields redacted |
| ⬜ | Public dashboard sharing | `publicToken` column exists |

## 10. Testing

| | Feature | Notes |
|---|---|---|
| ✅ | 213 unit tests | core 82, ingest 61, queries 30, worker 7, web 21, sdk-node 12 |
| ✅ | Injection-safety suite | Prototype pollution, wildcard leakage, param binding |
| ✅ | Query smoke runner | 32 queries against live ClickHouse |
| ✅ | Job verifier | Runs all 11 jobs once |
| ✅ | Tracker size gate | |
| ✅ | Load test | `scripts/loadtest.mjs` — asserts every acknowledged event reached ClickHouse |
| ✅ | Playwright end-to-end | 41 tests over every dashboard route, signed in against real Postgres and ClickHouse. `pnpm --filter @falorb/web e2e` |
| ✅ | CI pipeline | Typecheck, tests, size gate, then migrations + queries + jobs + load test + MCP against real services |

## 11. MCP server — `apps/mcp`

Lets any MCP-capable assistant query the platform directly. **25 tools, 2
resources, 3 prompts — all verified** with a real MCP client
(`pnpm --filter @falorb/mcp smoke` → 31/31).

| | Feature | Notes |
|---|---|---|
| ✅ | stdio transport | For Claude Desktop, Claude Code, any local client |
| ✅ | Streamable HTTP transport | For remote/hosted clients; `--http` |
| ✅ | API-key auth over HTTP | Bearer token; 401 without, rejects invalid |
| ✅ | **Tenant isolation** | Verified: a second org's key sees only its own projects and cannot name another tenant's |
| ✅ | Scope enforcement | Read-only key verified denied a write tool |
| ✅ | Per-request server instance | Scope cannot leak between concurrent callers |
| ✅ | Discovery tools | `list_projects`, `list_event_names`, `list_property_keys`, `describe_filters` |
| ✅ | Analytics tools | overview, stats, trend, breakdown, retention, stickiness, drop-off, user flows |
| ✅ | Funnel tools | `run_funnel`, `get_funnel_dropoffs` |
| ✅ | People tools | list, search, **full profile**, cross-project, sessions |
| ✅ | Live/ops tools | live visitors, event stream, platform health, alerts, install snippet |
| ✅ | Scoped write tool | `create_alert` (requires `write`) |
| ✅ | Resources | `falorb://projects`, `falorb://capabilities` |
| ✅ | Prompts | `weekly_review`, `conversion_audit`, `lead_research` |
| ✅ | LLM-shaped output | Markdown tables, pre-formatted numbers, relative times |
| ✅ | Flexible ranges | `7d`, `24h`, `today`, `mtd`, `2026-08-01..2026-08-16` |
| ✅ | Injection-safe | Verified: `evil; DROP TABLE events` rejected as a dimension |
| ✅ | Server instructions | Steer the model away from guessing event names and from overclaiming |
| ⬜ | OAuth for MCP | Currently bearer API keys only; fine for connectors that accept a token |
| ❌ | Destructive tools | **Deliberately excluded** — no project deletion or person erasure. Irreversible actions should not be reachable by an assistant acting on a misread instruction; erasure also needs a human to confirm the subject's identity. |

## 12. Accounts & onboarding — `apps/api`

Self-serve signup through to collecting data. **Whole flow verified
end-to-end**: new user → workspace → project → API key → live traffic → their
own AI reading it over MCP.

| | Feature | Notes |
|---|---|---|
| ✅ | Email + password signup | better-auth, scrypt hashing, 10-char minimum |
| ✅ | Sessions | 30-day, cookie-cached, snake_case field mapping to the existing schema |
| ✅ | Lazy workspace creation | Organization created on first authenticated request, not in a signup hook that could strand an account |
| ✅ | `GET /api/me` | Bootstrap: user, org, projects, scopes, onboarded flag |
| ✅ | Project CRUD | Create/list/update with unique-slug resolution |
| ✅ | Domain normalization | `https://www.adablog.com/` → `adablog.com` |
| ✅ | Install snippet on creation | Returned with the project |
| ✅ | API key management | Create (shown once), list (prefix only), revoke |
| ✅ | Dual auth | Session cookie for humans, bearer key for programs; same scope resolution |
| ✅ | Tenant-scoped mutations | Updates filtered by org, so a guessed slug matches nothing |
| ✅ | Email verification & password reset | Via Resend. Verification auto-enables only when a provider is configured, so an install without one cannot lock users out |
| ✅ | Team invites | Hashed tokens, 7-day expiry, acceptance bound to the invited address so a forwarded link grants nothing |
| ⬜ | OAuth providers | `account` table ready; none configured |
| ⬜ | Billing / plan limits | |

## 13. Integrations — Linki + Bund AI + Buffer + Clay built; generic multi-service design superseded

The generic "any service, inbound or outbound, via `integrations` /
`integration_syncs` / `integration_mappings`" design that used to live here
was never built. What got built instead is more specific: deep, two-way
integration with two of the operator's own products — **Linki** (sales
outreach/CRM) and **Bund AI** (AI customer support) — each running as its own
independently-deployed service that Falorb calls into and mirrors, rather
than a generic connector framework, plus two simpler, hosted-SaaS providers
that reuse the exact same `integrationConnections` table rather than needing
their own: **Buffer** (social post scheduling) and **Clay** (contact
enrichment for prospects discovered off-site, §17). The full phased plan for
Linki/Bund AI (with named risk gates for the parts that touch live external
systems) lives outside this repo at
`~/.claude/plans/modular-gathering-cocoa.md`; Buffer's plan is
`~/.claude/plans/composed-drifting-crystal.md`. This section tracks what of
it actually exists in code.

### Shape (what was actually built)

Falorb never becomes Linki's, Bund AI's, or Buffer's database. Linki and Bund
AI stay the owner of their own execution — real LinkedIn/email sending in
Linki, real customer chat in Bund AI; Buffer is a hosted third-party SaaS with
no execution of Falorb's to own. In all three cases Falorb is a client + a
read mirror:

- **Credential storage** — `schema.integrationConnections`
  (`packages/db/src/schema/integrations.ts`), one `provider`-discriminated
  table (`linki` | `bund_ai` | `buffer` | `clay` | `exa` | `firecrawl` |
  `elevenlabs`) rather than one table per service. API keys are AES-256-GCM
  encrypted (`packages/db/src/crypto.ts`, `INTEGRATION_CREDENTIAL_ENC_KEY`) —
  envelope encryption with a key outside the database, since these must be
  decryptable to use, unlike `api_keys.keyHash`.
- **Property-level overrides** — a row is either org-level (`projectId`
  null) or one property's own override (`projectId` set), same table, same
  shape, distinguished by two partial unique indexes rather than a second
  table: `(organizationId, provider)` where `projectId is null`, and
  `(organizationId, projectId, provider)` where `projectId is not null`. Read
  side is `activeConnection` in `apps/web/src/server/integrations.ts`: it
  prefers the calling property's own row and falls back to the
  organization's when the property has none for that provider. Write side is
  each property's Settings → Integrations panel
  (`apps/web/src/app/(app)/p/[project]/settings/IntegrationsPanel.tsx`),
  calling `connectProjectIntegration`/`testProjectIntegrationConnection`/
  `revokeProjectIntegrationConnection`
  (`apps/web/src/server/actions/integrations.ts`) — same
  connect/verify/revoke shape as the organization's panel, just scoped to
  one property's row instead. Wired into the read path today for Exa/
  Firecrawl (`content-draft.ts`'s `researchTopic`, which already has a
  property in scope) and exposed on every getter (`getBufferClient`,
  `getResearchClients`, etc. all take an optional `projectId`) for callers
  that gain property scope later. The periodic mirror/enrichment jobs
  (`linki-sync`, `bund-ai-sync`, `buffer-sync`, `clay-enrichment`,
  `ugc-video-gen`) deliberately stay org-level only — they pull one
  provider's full account into org-scoped mirror tables
  (`crm.*`/`support.*`/`social.*`) with no property dimension to mirror a
  property's override into, so a property override is read on demand, never
  swept by a background job.
- **Typed clients** — `packages/linki-client`, `packages/bund-ai-client`,
  `packages/buffer-client`, `packages/clay-client`,
  `packages/elevenlabs-client`, thin wrappers confirmed against each
  product's real API contract (not guessed) — except `buffer-client`, built
  against Buffer's public GraphQL docs instead of a live account; see §13b
  for why and the resulting caveats. Buffer, Clay, and ElevenLabs are all
  proof the one-table design scales past the original two providers: none
  needed a schema change to add, just a new `provider` enum value and a new
  client with the same `verifyConnection()` shape the generic
  connect/test/revoke actions already call — ElevenLabs' UGC video pipeline
  (§18) is a second consumer of that same machinery, not a special case
  bolted on beside it.
- **Mirror** — `packages/db/src/schema/crm.ts` (13 tables),
  `packages/db/src/schema/support.ts` (5 tables), and
  `packages/db/src/schema/social.ts` (2 tables: channels, posts), pulled by
  `apps/worker/src/jobs/{linki-sync,bund-ai-sync,buffer-sync}.ts` — see §7.
  Sync health is `integrationConnections.lastSyncedAt`, not a separate
  `integration_syncs` table. Clay and ElevenLabs have no table here — Clay's
  enrichment writes to `prospects` (§17) instead, and ElevenLabs' output is
  generated content Falorb creates via the API, not a mirror of pre-existing
  external data — see §18.
- **Identity resolution** — a set-based SQL backfill after each sync links a
  mirrored contact/lead/conversation to a Falorb `person` by email match (or,
  for Bund AI conversations, `identifiedId` == the widget's `externalUserRef`,
  best-effort). This is the `person_aliases`-adjacent resolution the old
  design called out as "the hard part" — implemented directly rather than via
  a new alias kind, since a CRM contact isn't a device/session identity the
  way `person_aliases` models. Buffer's mirror has no equivalent: a scheduled
  or sent post isn't naturally scoped to one analytics person, so
  `social.ts` carries no `personId` column.
- **Manual actions** — `apps/web/src/server/actions/{crm,support,social}.ts`:
  push a signal to Linki, create/update a Linki contact, resolve a Bund AI
  escalation, compose and publish a Buffer post. Deliberately per-record and
  human-clicked (`can.actOnIntegrations`, member tier), not a bulk/automated
  flow.

### 13b. Buffer specifics

Buffer's third-party API access has a messy history that shaped this
integration's auth model:

- Buffer closed third-party OAuth app registration in 2019, revoking existing
  integrations. A new GraphQL API (`api.buffer.com`) relaunched in beta in
  early 2026, but — per Buffer's own docs plus independent developer
  write-ups — it issues **personal API keys scoped to one Buffer account**,
  with no "connect someone else's account" OAuth flow for third parties. The
  legacy REST API, which did support real OAuth, accepts no new app
  registrations and is being retired February 1, 2027.
- Given that, this integration deliberately uses the personal-key model —
  the same shape as Linki/Bund AI's connect form — rather than building
  speculative OAuth/token-refresh infrastructure against an approval process
  of unknown availability. The real limitation this carries: **each Falorb
  organization can only connect one Buffer account it personally controls**,
  not an arbitrary customer's, unlike a true third-party OAuth integration
  would allow. This is a Buffer platform restriction, not a Falorb gap —
  documented here rather than silently designed around.
- Buffer's endpoint is fixed (`https://api.buffer.com`, exported as
  `BUFFER_API_ENDPOINT`), unlike Linki/Bund AI which are self-hosted — same
  shape as Clay's and ElevenLabs' fixed roots. `IntegrationsPanel.tsx`'s
  shared `HAS_BASE_URL` map skips the base-URL field in the connect dialog
  for all three, and the server-side `FIXED_BASE_URL` map (in
  `apps/api/src/routes/integrations.ts` and
  `apps/web/src/server/actions/integrations.ts`) fills the value in rather
  than trusting the client to send it, so
  `integration_connections.base_url` still has a value for every provider
  without a schema exception.
- Buffer's GraphQL API is Relay-cursor-paginated (`after`/`first` →
  `edges`/`pageInfo`), unlike Linki/Bund AI's `limit`/`offset` REST
  pagination — `BufferClient.listPosts` cursor-walks internally rather than
  `buffer-sync.ts` driving pages itself, so there's no `paginateAll` helper
  reused there.
- **Caveat, stated rather than hidden**: `packages/buffer-client` was written
  against Buffer's documented schema, not a live account — no personal API
  key was available while building this. Field names, the exact auth header
  format, and whether `dueAt`/`sentAt`/`metricsUpdatedAt` serialize as ISO
  strings or Unix seconds are unconfirmed until a real key is connected and
  `buffer-sync` runs against it. `buffer-sync.ts`'s `toDate()` handles both
  serializations defensively for that reason.

### Not yet built

- **Automated, rule-based signal push.** The plan's Gate B (bulk, unattended
  "Falorb detects a qualifying person → auto-pushes a signal → Linki's own
  rules may enroll them in a live workflow") is designed but not implemented.
  Only the manual, one-person-at-a-time version above exists.
- **Bulk/automated Linki contact creation** (Gate C) and any Bund AI write
  beyond resolving one escalation (Gate E's narrower scope) — not built.
- **Bund AI's inbound webhook receiver.** Bund AI can push
  (`send_webhook` automation action), but Falorb has no
  `POST /api/integrations/bund-ai/events` to receive it yet — `bund-ai-sync`
  is poll-only, which the design always treated as an acceptable fallback,
  not a broken half-measure.
- **Full read-only dashboard.** `/crm` now covers contacts (full paginated
  mirror at `/crm/contacts`, plus the pre-existing unmatched-backlog tab),
  workflows, lists, signal rules, runs (`/crm/runs/[id]` for per-target,
  per-channel track state), sent messages and suppressions; `/support`
  covers Bund AI conversations/leads/tickets. Bund AI escalations remain the
  only Bund AI surface with a detail view — its conversations/leads/tickets
  are list-only.
- **Buffer post editing/deletion/queue reordering.** Only `createPost` is
  wired to a manual action (`/social`); `BufferClient.deletePost` exists but
  nothing in the UI calls it yet, and `movePostInQueue`/`editPost` aren't in
  the client at all.
- **Buffer aggregated analytics.** Per-post metrics mirror into
  `socialPosts.metrics`, but Buffer's `aggregatedPostMetrics` query (rollups
  across a filtered post set) isn't pulled — no dashboard view needs it yet.
- **MCP exposure** — no `list_crm_contacts`/`get_sync_status`-style tools yet,
  matching the old design's intent that connect/disconnect and any write stay
  out of MCP's reach regardless.

### Design constraints carried over from the old plan, honored

- Credentials encrypted at rest, never returned by any API response. Clay's
  connect form additionally never redisplays the stored key at all — the
  panel shows only the last-4 preview, same convention as `api_keys`.
- Every connection and every mirrored row is per-organization.
- A resolution to an existing person is never guessed — email or an explicit
  `identify()`-equivalent signal only, same standard as `person_aliases`.
  (Clay's enrichment writes to `prospects`, §17, which is deliberately
  outside `person_aliases` — a prospect is not a resolved identity.)
- Sync failures are visible (`integrationConnections.status`/`lastError`),
  not silently indistinguishable from "nothing changed."
- Connect/disconnect stays a dashboard-only action for every provider,
  including Clay and ElevenLabs — no MCP tool can create, rotate, or revoke
  a credential.

### Not planned

Anything that ships personal data to an ad network for cross-site retargeting.
That would reintroduce, through a side door, exactly the tracking this platform
deliberately does not do. Generic, arbitrary-service integrations (Stripe,
HubSpot, Slack, Shopify, Search Console) remain unbuilt and are no longer the
near-term direction — Linki and Bund AI cover sales/support, and Buffer now
covers social posting. Postiz (the open-source, self-hosted social scheduler
originally queued for this slot) was not built — Buffer was chosen instead
once this specific integration was requested; Postiz remains a separate,
undecided possibility if a self-hosted alternative is wanted later, not
something this work replaced.

## 14. Dashboard — `apps/web`

Next.js 15 App Router on React 19, built on the Falorb design system. **33
routes, production build passing, and an end-to-end suite that drives most of
them in a browser** (`pnpm --filter @falorb/web e2e`, 41 tests — the eight
newest routes are verified manually via typecheck/build/live curl, not yet in
that suite; see §14d–§14j). `/support` (newest) typechecks but has not been
exercised against a live Bund AI connection — see §13. Server components call
`@falorb/queries` directly — no HTTP hop between the dashboard and the query
layer.

| | Route | Purpose |
|---|---|---|
| ✅ | `/` | All-properties overview — stat strip, per-property sparkline + delta |
| ✅ | `/p/[project]` | Property summary — totals, visitors/sessions trend, four breakdowns |
| ✅ | `/p/[project]/live` | Realtime feed, pages and countries now, longest-on-site |
| ✅ | `/p/[project]/people` | Person list — debounced search, identified filter, sort, paging |
| ✅ | `/people/[personId]` | **Deep profile** — cross-property timeline, products used, acquisition chain, interests, aliases. Also carries a "Linki" card (🟡, see §13) — linked contact, plus manual create/update/push-signal actions |
| ✅ | `/p/[project]/funnels` | URL-encoded builder + drop-off waterfall |
| ✅ | `/p/[project]/paths` | Sankey + entry/exit/frustration reports |
| ✅ | `/p/[project]/content` | Content & interest insights — needs-attention, top pages, entry/exit, project-level interest rollup with trend; "rising interest, thin coverage" rows can auto-draft a page, see §14h |
| ✅ | `/p/[project]/content/drafts/[id]` | Viewer for an AI-drafted content page — title, meta description, markdown body; see §14h |
| ✅ | `/p/[project]/retention` | Cohort grid + stickiness distribution |
| ✅ | `/p/[project]/events` | Event explorer with per-event filtering and session list |
| ✅ | `/p/[project]/crawlers` | **AI & crawlers** — see §14b |
| ✅ | `/p/[project]/goals` | Goals CRUD + conversions + three attribution models |
| ✅ | `/p/[project]/referrals` | Referral link CRUD + click/visitor/conversion leaderboard, plus an optional incentive (discount/credit/unlock) per link; see §14d |
| ✅ | `/r/[code]` | Public redirect for a referral link — outside the auth group, same shape as `/share/[token]`. When the link carries an incentive, an interstitial shows it first (3s meta-refresh, no JS required) before continuing; a link with no incentive redirects exactly as before, no regression |
| ✅ | `/p/[project]/signals` | AI-generated growth recommendations — content, product, marketing, sales; see §14e |
| ✅ | `/p/[project]/waitlist` | Owner view of a property's waitlist — join link, ranked entrant table with referral counts; see §14j |
| ✅ | `/waitlist/[token]` | Public waitlist join form, outside the auth group; reads `?ref=` and shows the entrant their position + personal invite link on success; see §14j |
| ✅ | `/p/[project]/settings` | Snippet, public link, domains, timezone, identity scope, consent, retention, embeddable badge snippet (see §14i) |
| ✅ | `/settings` | Instance settings — properties, endpoints (now including the referral-link origin, see §14d), workspace, weekly digest opt-out (§14f), benchmark report link (§14g) |
| ✅ | `/settings/team` | Members, roles, invitations |
| ✅ | `/settings/mcp` | API keys + MCP connection config |
| ✅ | `/settings/new` | Add a property |
| ✅ | `/insights` | Cross-project builder — metric × dimension × chart, people across products |
| ✅ | `/prospecting` | Org-wide list of prospects discovered off-site (social listening) with contact enrichment and outreach drafting — see §17 |
| 🟡 | `/ugc-videos`, `/ugc-videos/[id]` | Generate and review AI UGC-style videos, queue them for posting — see §18. Typechecks, never exercised against a live ElevenLabs connection |
| ✅ | `/alerts` | Delivery channels, rules, firing history |
| 🟡 | `/support` | Bund AI escalations mirrored from a connected business, resolvable in one click; see §13. Typechecks, never exercised against a live connection |
| ✅ | `/share/[token]` | Public read-only property summary |
| ✅ | `/badge/[token]` | Public embeddable "N visitors this month" widget, meant for an `<iframe>` on the property owner's own site; see §14i |
| ✅ | `/benchmark/[token]` | Public, indexable portfolio-wide "state of X" aggregate report — rollup only, no per-project or per-person data; see §14g |
| ✅ | `/invite/[token]` | Invitation acceptance, bound to the invited address |
| ✅ | Auth | better-auth mounted same-origin at `/api/auth`; config shared with the API via `@falorb/auth` |
| ✅ | SSE live streaming | `/api/live/[project]`, 3s poll, cursor-advanced, 30-min self-close |
| ✅ | Light & dark themes | Cookie-backed, server-rendered so there is no flash; "system" follows the OS |
| ✅ | Roles enforced | Every mutation re-derives the caller's role server-side; see §14c |

## 14a. Design system — `packages/ui`

| | Feature | Notes |
|---|---|---|
| ✅ | 32 components ported | Copied from `Design System/`, not rewritten |
| ✅ | Reproducible sync | `pnpm --filter @falorb/ui sync` re-copies and re-applies the deltas; `sync:check` fails CI on drift |
| ✅ | Fonts self-hosted | `next/font` replaces the CDN link, so tabular figures do not arrive late and reflow number columns |
| ✅ | Pure black, neutral ramp | `--ink-1000` is `#000000` and every step is R=G=B; the ramp used to carry a cool cast |
| ✅ | Light theme | `tokens/themes.css` re-points the semantic layer. Alpha-whites become alpha-blacks, elevation becomes shadow, accent and signal ramps darken for contrast |

**Six deltas from the design system source**, all encoded in the sync script:
`"use client"` on every component; `Icon` from bundled `lucide-react` rather
than a CDN sprite; `React.JSX.Element` for React 19; `useId` gradient ids
(`Math.random()` broke hydration); `Checkbox`/`Switch` given real inputs (they
were spans with click handlers — no keyboard, no label association, no ARIA);
`Select` renders through a portal (as a positioned child it was clipped by
`Card`'s `overflow: hidden` and by scroll containers).

## 14b. AI usage — `/p/[project]/crawlers`

Answers what ChatGPT, Claude, Perplexity and the rest do with a property.

| | Feature | Notes |
|---|---|---|
| ✅ | Answering vs ingesting | `ChatGPT-User` (a person asked, and is waiting) is now a different agent from `GPTBot` (bulk corpus). The classifier previously collapsed them, losing the more valuable one |
| ✅ | Agent inventory | Vendor, request volume, share, and the robots.txt token that would block it |
| ✅ | Referrals back | Visitors arriving *from* an assistant — the only figure showing the reading produced a reader |
| ✅ | Pages being read | What the assistants actually fetch |
| ✅ | `bot_name` filterable | Added to the query layer's allow-list; it was stored but not reportable |

## 14c. Roles and team

| | Feature | Notes |
|---|---|---|
| ✅ | Canonical role model | `@falorb/db/roles` — owner > admin > member > viewer, shared by API and dashboard so the two cannot disagree |
| ✅ | Enforced on every mutation | Project settings, goals, alerts, channels, sharing, keys and team all re-derive the role server-side. A server action is a public endpoint; a hidden button is not a check |
| ✅ | Invitations | Hashed tokens, 7-day expiry, acceptance bound to the invited address, membership and consumption in one transaction |
| ✅ | Last-owner guard | The only owner cannot be demoted or removed |

## 14d. Referral links — `/p/[project]/referrals`

Shareable links attributed from click through to eventual `identify()`.
Verified end to end against a real ingest → sessionizer → identity-resolver →
leaderboard pass, not just the UI in isolation.

| | Feature | Notes |
|---|---|---|
| ✅ | Link CRUD | Owner-chosen code (not a secret, unlike the share token — no hashing), label, optional destination; soft revoke preserves leaderboard history |
| ✅ | `ref_code` capture | Parsed server-side from the landing URL at ingest, kept deliberately distinct from `parseUtm`'s existing `ref` alias — reusing that name would have silently corrupted UTM attribution |
| ✅ | Frozen first-touch attribution | `persons.firstReferralCode`, populated by the sessionizer with the same `coalesce` pattern as `firstUtmCampaign` and its siblings |
| ✅ | Click/visitor/conversion leaderboard | Clicks derived from `events_v` pageviews (same convention as every other acquisition dimension), never a separate counter that could disagree |
| ✅ | Public redirect | `/r/[code]`, 302, `Cache-Control: no-store`. Unknown/revoked codes redirect to a fallback rather than 404 — a code gates no private data, so there is no reason to make failure indistinguishable the way the share token does |
| ✅ | Branded domains | Optional `projects.linkDomain`, DNS-verified via CNAME lookup, middleware rewrites a matching Host header's path to `/r/[code]` internally. Requires Node.js-runtime middleware (`export const runtime = "nodejs"`) for the Postgres lookup — confirmed supported by this Next.js version |
| ✅ | Own subdomain for shared links | `referralLinkUrl()` prefers `FALORB_REFERRAL_URL` (e.g. `refer.<domain>`) over `FALORB_APP_URL`, so a link someone actually shares doesn't read as the internal dashboard's own address — same app, same `/r/[code]` route, `infra/Caddyfile`/Coolify just proxy the extra hostname to it. Falls back to `FALORB_APP_URL` when unset. `waitlistJoinUrl()` (§14j) follows the identical pattern with `FALORB_WAITLIST_URL` (e.g. `list.<domain>`) |
| ✅ | Incentive layer | Optional `incentiveKind` (`discount`\|`credit`\|`unlock`), `incentiveValue`, `incentiveDescription` per link — a reason to actually share it. When set, `/r/[code]` shows a brief interstitial (the incentive copy, a "Continue" link, a 3s no-JS meta-refresh) before continuing; a link with no incentive still redirects instantly, unchanged. The leaderboard's existing `conversions` count doubles as "credits earned" for `credit`-kind links — no separate accounting |
| 🟡 | Playwright coverage | Verified manually (ingest batch → watermark-reset sessionizer run → Postgres → leaderboard, plus a Host-header-spoofed `curl` for the branded-domain rewrite, plus a live interstitial/no-regression check for the incentive layer); no `referrals.spec.ts` yet |

## 14e. AI growth signals — `/p/[project]/signals`

On-demand recommendations generated via OpenRouter from data the platform
already computes — not a new data source, a synthesis step over the existing
query layer.

| | Feature | Notes |
|---|---|---|
| ✅ | Four signal kinds | Content (page performance + interest graph), product (interest graph **and** funnel-agnostic drop-off, see the `topDropoffs` row below — the gap this table used to note is closed), marketing (channel breakdown + referral leaderboard), sales |
| ✅ | `topDropoffs` closes the product gap | `packages/queries/src/dropoff.ts`. The `path_transitions` rollup table (§4) has no exit sentinel — every row is evidence of *not* leaving — so it can't be ranked for abandonment on its own. Instead it's cross-referenced with `exitPages`'s real per-page exit rate: for every `(fromPath, toPath)` edge, join in `toPath`'s exit rate, rank by `exitShare × transitions`. Reads as "people came from X, landed on Y, and left from Y at an unusually high rate" — sequence-aware abandonment neither existing query provided alone. `exitShare` is the page's overall exit rate, not conditioned on the specific `fromPath` (an approximation, documented in the query itself) |
| ✅ | Sales: two independent scopes | "This property" reuses `listPeople` sorted by lead score; "across your portfolio" uses `crossProjectPeople`, which floors `minProjects` at 2 and so cannot be forced into a single-project query — the two scopes are genuinely different code paths, not one query with a parameter |
| ✅ | Sales: structured hot-leads list with actions | The signal panel used to be prose-only. Each hot lead (from the same `hotLeads()` data) now renders as a row with a "Mark contacted" toggle (`persons.contactedAt`/`contactedBy` — a human-only field, deliberately separate from the visitor-supplied, `identify()`-merged `traits` bag) and a "Draft outreach message" button that calls OpenRouter with that one lead's data for a personalized 3-5 sentence draft, shown in a copyable field |
| ✅ | Portfolio-scoped caching | `ai_signals.projectId` is nullable, mirroring `dashboards.projectId`'s existing precedent for the same reason; a portfolio-wide signal is scoped by `organizationId` instead and reads the same regardless of which project's page triggered it |
| ✅ | Cached, not generated per page load | 5-minute regenerate cooldown per `(projectId, kind)` pair, same shape as the rate limiting elsewhere in the dashboard |
| ✅ | Model selection | Defaults to `"openrouter/auto"` (OpenRouter picks per request) rather than pinning one; `OPENROUTER_MODEL` overrides with a single model or a comma-separated fallback list |
| ✅ | Plain-text output, guaranteed | A prompt instruction against markdown is not reliable on its own — verified live that models still reach for `**bold**` and `##` headers — so `stripMarkdown` strips it programmatically after generation. Deliberately skips underscore-based emphasis: the context data is full of snake_case field names (`utm_source`, `content_tag`) the model echoes back, and a naive single-underscore rule would merge two unrelated words together |
| ✅ | Graceful failure | No `OPENROUTER_API_KEY` configured, an unreachable upstream, an empty response, and a real `402` (insufficient OpenRouter credits, hit live during testing) all surface as a clear toast, never a crash |
| ✅ | Shared across web and worker | The OpenRouter call, prompts and markdown-stripping moved to their own package, `packages/ai` — not `@falorb/core`, which is documented as pure/browser-safe and gets bundled into the client; a secret-holding network call must never live there. `apps/web/src/server/ai.ts` re-exports it behind the app's server-only boundary; `apps/worker`'s digest job (§14f) imports it directly |
| 🟡 | Playwright coverage | Verified manually for all four kinds and both sales scopes, including a real generated recommendation end to end; no automated coverage yet |

## 14f. Weekly digest email

Push instead of pull: the four AI signals used to require opening the
dashboard and pressing Generate. A worker job now regenerates all of them for
every property weekly and emails one summary per organization.

| | Feature | Notes |
|---|---|---|
| ✅ | `digest` worker job | `apps/worker/src/jobs/digest.ts`, weekly, `skipOnBoot`. Regenerates content/sales/marketing/product for every project in an org with `organizations.weeklyDigestEnabled` (default on), one project's failure caught independently so it can't take down the rest, each result persisted to `ai_signals` same as an on-demand regenerate |
| ✅ | Recipients | Every `owner`/`admin` member of the org, via `packages/mailer`'s existing Resend/SMTP/log transport chain — no new delivery mechanism |
| ✅ | Org-level opt-out | `organizations.weeklyDigestEnabled` toggle on `/settings`, gated by `manageProject` |

## 14g. Public benchmark report — `/benchmark/[token]`

A shareable "state of X" page: aggregate rollup stats across an operator's
whole portfolio, meant to be found and linked to rather than kept private —
the opposite intent of `/share/[token]`, built on the identical mechanism.

| | Feature | Notes |
|---|---|---|
| ✅ | Reuses the `dashboards.publicToken` pattern | Same table `/share/[token]` uses, at the `projectId IS NULL` (portfolio-wide) row — no new schema |
| ✅ | Aggregate-only query | `packages/queries/src/benchmark.ts` — visitors, sessions, pageviews, bounce rate, average and median session duration, top channels by share. No per-project or per-person figure in the result set, so there is nothing to leak beyond the report's own existence |
| ✅ | Deliberately indexable | Unlike every other token-gated page in this app, `generateMetadata` explicitly sets `robots: {index:true, follow:true}` — the root layout defaults every page to `noindex`, so omitting the override (rather than setting it) would have silently inherited the private default |
| ✅ | Issue/rotate/revoke | `BenchmarkShareControl` on `/settings`, gated by the same `share` capability (admin+) as the per-property share link |

## 14h. Content auto-draft — `/p/[project]/content`

The Content page's "rising interest, thin coverage" rows used to be a table
to read and act on manually. A button now drafts an actual page for that
topic via OpenRouter, stored for the owner to copy elsewhere — there is no
CMS integration, so this stops at drafting, not publishing.

| | Feature | Notes |
|---|---|---|
| ✅ | One-click draft per topic | `draftContentPage` action, `content_drafts` table (`title`, `metaDescription`, markdown `body`, the source `topic` and interest context) |
| ✅ | Markdown preserved | `@falorb/ai`'s `complete()` strips markdown by default for prose signals; this caller passes `stripMarkdown: false` (an additive option) since the output is meant to stay markdown |
| ✅ | Draft viewer | `/p/[project]/content/drafts/[id]`, three copyable fields (title, meta description, body) plus a list of past drafts on the Content page |

## 14i. Public embeddable traffic badge — `/badge/[token]`

A small "N visitors this month" / live-count widget any property can embed
elsewhere — a Statcounter/Wistia-style backlink loop, reusing the same public
token `/share/[token]` already mints.

| | Feature | Notes |
|---|---|---|
| ✅ | Same token, second surface | No new capability minted — the badge reads the property's existing `dashboards.publicToken`; revoking the share link breaks the badge too, by design |
| ✅ | Framing carve-out, scoped narrowly | The app's blanket `X-Frame-Options: DENY` (`next.config.mjs`) and CSP `frame-ancestors 'none'` (`src/middleware.ts`) both exclude `/badge/*` specifically — an iframe-embeddable widget cannot carry either — everything else in the app keeps the strict defaults |
| ✅ | Escaped output | The one owner-controlled string rendered (`domain`/`projectName`) goes through a local `escapeHtml`, since this route intentionally has no CSP to fall back on |
| ✅ | Cache-Control, not per-view queries | `public, max-age=120, s-maxage=120, stale-while-revalidate=300` — a busy embed doesn't hit ClickHouse on every page load; `resolveShare`/`totals`/`liveCounts` still run `force-dynamic` server-side so a revoked token stops resolving within the cache window, not instantly but not indefinitely either |

## 14j. Waitlist with referral-boosted position — `/p/[project]/waitlist`

An early-access queue where inviting people moves you up it — the most
classically viral of the growth features, for a property with something
pre-launch to attach it to.

| | Feature | Notes |
|---|---|---|
| ✅ | `waitlist_entries` table | Per-project, unique on `(projectId, email)`; every entrant gets a `referralCode` and may carry a `referredByCode` |
| ✅ | Position computed live, never stored | Base rank is signup order; each successful referral moves an entrant up 3 spots. Computed with a window function + join, not cached — matches the table's own doc comment on why a stored rank would drift |
| ✅ | `projects.waitlistToken` gates the public join page | Same nullable-unique-token-by-presence convention as `dashboards.publicToken` |
| ✅ | Own subdomain for join links | `waitlistJoinUrl()` prefers `FALORB_WAITLIST_URL` (e.g. `list.<domain>`) over `FALORB_APP_URL`, same reasoning and fallback as `referralLinkUrl()` (§14d) |
| ✅ | Owner view | `/p/[project]/waitlist` — enable/disable, the join link, a ranked entrant table with referral counts |

## 14k. Web research — Exa + Firecrawl

Two per-organization connections through Settings → Integrations (§13), the
same shape as Linki/Bund AI/Clay — connected from `IntegrationsPanel.tsx`,
stored in `integrationConnections`, no platform-wide key. Grounds two
existing AI features in real web content instead of the LLM's own guesses.

| | Feature | Notes |
|---|---|---|
| ✅ | `packages/research` | `ExaClient`/`FirecrawlClient`, same shape as `@falorb/linki-client`/`@falorb/clay-client` so they plug into the generic connect/test/revoke actions unchanged — `EXA_DEFAULT_BASE_URL`/`FIRECRAWL_DEFAULT_BASE_URL` are supplied server-side like Clay's, so their connect dialogs ask only for an API key, no base URL. `ExaClient.verifyConnection()` is a minimal 1-result `/search` (no dedicated health endpoint); `FirecrawlClient.verifyConnection()` is the free `GET /v1/team/credit-usage` (no credits spent, unlike scrape/search) — both verified live against real accounts, including the 401 path for a bad key |
| ✅ | Exa and Firecrawl are fallbacks for each other | Never called together for one request: `search()` (`orchestrate.ts`) tries a connected Exa client first and only reaches for Firecrawl's own search if the org has no Exa connection or Exa errors; `fetchPage()` tries a connected Firecrawl client first and only reaches for Exa's `/contents` if the org has no Firecrawl connection or it errors. `apps/web/src/server/integrations.ts`'s `getResearchClients(organizationId)` builds the `{exa, firecrawl}` client bag each caller passes in — a `null` entry just means that provider isn't connected |
| ✅ | Content drafts research | `draftContentPage` (§14h) now calls `researchTopic` first: a web search for the topic sees what already ranks, folded into the OpenRouter prompt so the draft is differentiated rather than a generic overview. Falls back to the interest-data-only prompt if the organization has connected neither provider or both error — never blocks the draft |
| ✅ | Company research | "Research this company" action on the person profile's Company card (`CompanyResearchCard.tsx`, `enrichCompany` action) — fills `companies.industry`/`employeeRange`/`linkedinUrl`, fields the automatic ASN-based enrichment job (§4, `apps/worker/src/jobs/enrichment.ts`) never populates since it only ever learns a network operator's registered name. A scrape of the company's own homepage feeds one short OpenRouter call that extracts only what the content actually states — told explicitly to leave a field `unknown` rather than infer it. Verified live: a Firecrawl scrape of a real homepage (anthropic.com) correctly extracted "AI research and products" as industry and left size/LinkedIn blank rather than inventing them. Gated by `writeAnalysis` (member+); connecting/revoking Exa or Firecrawl itself is gated by `manageIntegrations` (admin+), same split as every other integration. Skipped entirely for an ASN-only placeholder company (`as12345`, no real domain to research) |
| ✅ | Graceful degradation | An organization that has connected neither provider (or whose connected one errors) gets a clean `ResearchUnavailableError`/toast rather than a blocked action — the underlying fallback logic is unit-independent of *how* a client was obtained, so this carries over unchanged from when it was verified against the both-unconfigured env-var case |

## 15. SDKs

| | Package | Notes |
|---|---|---|
| ✅ | `packages/sdk-node` | Non-blocking, never throws, batches by identity. 12 tests |
| ✅ | `packages/sdk-react` | `<FalorbProvider>`, `useFalorb`, `usePageview`, `useIdentify`. Customer-facing library — **not** the dashboard |

## 16. Deployment

| | Feature | Notes |
|---|---|---|
| ✅ | Local Docker Compose | Verified cold start |
| 🟡 | Coolify deployment | Dockerfiles, production compose and [DEPLOY.md](infra/DEPLOY.md) built and verified locally; the Coolify MCP is read-only so the console steps are manual |
| ✅ | Caddy config | `infra/Caddyfile` — `a.` / `dashboard.` / `mcp.` on separate hostnames |
| ✅ | Backups | `infra/backup.sh` — incremental ClickHouse, verified gzip for Postgres |
| ⬜ | Rollout to the operator's own live sites | one deployment instrumenting every property in the portfolio |

## 17. Prospecting — social listening & contact enrichment

The other half of "who to contact" alongside §14e's on-site hot leads: people
discovered talking about the product somewhere the organization doesn't own,
not people already tracked as visitors. Deliberately a new table
(`prospects`) rather than a `persons` row with no site history —
`persons.ts`'s docblock is an explicit privacy boundary ("every field is
derived from first-party activity on the org's own properties") that an
externally-discovered person does not fit.

| | Feature | Notes |
|---|---|---|
| ✅ | `prospects` schema | Source, excerpt, matched keywords, AI relevance score, contact-enrichment cache (mirrors `companies`'s `raw`/`enrichedAt`/`lookupFailedAt` shape), status, owner-set `contactedAt`/`contactedBy`, optional `personId` for a future **human-confirmed** merge only |
| ✅ | `prospect_keywords` | Per-project listening config — configured on that property's own Settings tab even though results are consumed org-wide, same split as goals/referral links |
| ✅ | Clay credential storage | Reuses §13's shared `integrationConnections` table (`provider = "clay"`) rather than a prospecting-specific one — same envelope encryption (`packages/db/src/crypto.ts`, `INTEGRATION_CREDENTIAL_ENC_KEY`) Linki/Bund AI already use. `packages/clay-client` is the typed client, same `verifyConnection()` shape as `LinkiClient`/`BundAiClient` |
| ✅ | `reddit-listener` worker job | 15m. Platform-wide Reddit app-only OAuth (no per-org credential needed — unlike Clay, nothing here is org-specific), soft-disables without `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`. Per-keyword try/catch, dedup on `(org, source, source_id)`, AI relevance scoring via `@falorb/ai` that never blocks insertion on a scoring failure. In `verify:jobs` |
| ✅ | `clay-enrichment` worker job | 30m. Per-org loop over connected Clay `integrationConnections`, each org's own try/catch so one bad/rotated key can't stop the sweep; negative-result caching like `enrichCompanies`. Sync health lives on the connection row (`lastSyncedAt`/`lastError`), same convention as `linki-sync`/`bund-ai-sync` — no separate run-history table. Deliberately **excluded** from `verify:jobs` — unlike every other job there, a live run spends a connected org's own paid Clay credits. Covered instead by a unit test of the response parsing (`packages/clay-client/src/index.test.ts`) |
| ✅ | `/prospecting` | Top-level route, not a per-project tab — a prospect is discovered via one project's keywords but the useful view is portfolio-wide, same reasoning as `hotLeads`'s `"portfolio"` scope. Mark contacted, dismiss, draft outreach (AI, grounded in the specific public post — never implies an on-site relationship that never happened) |
| ✅ | Clay on `/settings/integrations` | A third `ProviderCard` alongside Linki/Bund AI, not a bespoke panel — reuses the generic connect/test/revoke actions unchanged. Its connect dialog has no Base URL field (Clay has one fixed API root, set server-side); gated `manageIntegrations` (admin+), the same tier every other integration credential uses |
| ✅ | MCP tools | `apps/mcp/src/tools/prospects.ts` — `list_prospects`, `get_prospect`, `list_prospect_keywords` (read); `mark_prospect_contacted`, `dismiss_prospect`, `draft_prospect_outreach`, `add_prospect_keyword`, `remove_prospect_keyword` (write). Connect/disconnect deliberately **not** exposed, per §13's stated integrations rule |
| ✅ | Verified | Full monorepo typecheck + test suite, production build (33 routes total, including `/prospecting`), `verify:jobs` (`reddit-listener` soft-disables cleanly without credentials), and a live walkthrough against the dev stack: signed up, added a listening keyword on a property, confirmed it renders on `/prospecting`, connected/tested/revoked a test Clay key on `/settings/integrations` |
| 🟡 | Playwright coverage | Verified manually as above; no automated end-to-end coverage yet, same gap as every other §14d–§14j feature |
| ⬜ | Comment/social platforms beyond Reddit | X/LinkedIn need a paid API tier or a listening-as-a-service vendor; deliberately deferred to keep the first version's cost at zero |

---

## 18. UGC AI video generation — script, voice, and a talking avatar video

Built in-house rather than integrating a single UGC vendor (Arcads, HeyGen,
Synthesia) — a chain of calls Falorb owns end to end: a script
(`@falorb/ai`'s `complete()`, same OpenRouter path §14e's AI signals use), a
voiceover, then a lip-synced talking video animating a user-supplied
presenter photo. The voice and video stages both go through ElevenLabs —
their Flows video API added an image+audio-to-video lipsync model
(`creatify-aurora`) in 2026, so one vendor now covers both stages rather than
a separate TTS vendor and a separate avatar vendor.

ElevenLabs is connected exactly like Linki/Bund AI/Clay (§13): each org
brings its own ElevenLabs account via `integrationConnections`
(`provider: "elevenlabs"`) on `/settings/integrations`, not a Falorb-wide
shared key. An org's own voices (including any clones) and its own billing —
not a pooled credential every org draws against.

Org-wide (`/ugc-videos`), not a per-project tab — same reasoning as §17: a
UGC ad is marketing content for the business, not analysis of one property's
traffic. A video's `projectId` is an optional tag for which property/brand
it's for, not an ownership scope.

| | Feature | Notes |
|---|---|---|
| ✅ | `ugc_videos` schema | Org-scoped, optional `projectId` tag. `status` is both the lifecycle and the resume point (`pending → script_ready → voice_ready → video_processing → ready`, or `failed`) — plain `text()`, UI-driven vocabulary, same convention as `prospects.status`. Presenter photo and generated voiceover stored as base64 `text` (Falorb has no object storage yet; both are small — see the table's own docblock for why introducing a blob store solely for this one feature would be premature). The final video itself is **not** re-hosted — `videoUrl` points at ElevenLabs' own output URL |
| ✅ | `ugc_video_post_queue` schema | A human-curated "post this" to-do list, not automated posting — Postiz (queued, §13) doesn't exist yet. Nothing transitions an entry out of `queued` except a person clicking "mark posted" on the review page |
| ✅ | `elevenlabs` on `integration_provider` | Fourth value on the enum `packages/db/src/schema/integrations.ts` already had (`linki`/`bund_ai`/`clay`) — no new table, same encrypted-credential row shape as the other three |
| ✅ | `@falorb/elevenlabs-client` | Thin client for `POST /v1/text-to-speech/{voice_id}` (confirmed against ElevenLabs' stable docs) and the Flows video API `POST /v1/flows/video` + `GET /v1/flows/video/{id}` (2026, still beta on ElevenLabs' side — the request schema for `creatify-aurora` is confirmed, the completed-generation response shape is not, so `getVideoGeneration` checks several plausible field names rather than asserting one; same "verify before production traffic" caveat `@falorb/clay-client` carries for its own contract). `verifyConnection()` pings `GET /v1/user` — cheapest authenticated call that doesn't spend generation credits, same "who am I" reasoning `ClayClient`'s equivalent method gives |
| ✅ | ElevenLabs on `/settings/integrations` | A fourth `ProviderCard`, not a bespoke panel — reuses the generic connect/test/revoke actions unchanged. Its connect dialog has no Base URL field (ElevenLabs has one fixed API root, set server-side, `ELEVENLABS_DEFAULT_BASE_URL`), gated `manageIntegrations` (admin+), same tier every other integration credential uses |
| ✅ | `ugc-video-gen` worker job | 1m interval — short, deliberately, since this is user-facing and someone is on the review page waiting. Per-organization loop over connected `elevenlabs` `integrationConnections`, same shape as `clay-enrichment.ts`: each org's own decrypted key, each org's own try/catch so one bad/revoked key can't stop the sweep for other orgs, connection health (`lastSyncedAt`/`status`/`lastError`) reflects the run. Within one org's batch, advances **one stage per row per tick** rather than running the whole chain in one call, so a crash mid-chain resumes from the last persisted stage instead of re-running (and re-billing) earlier stages; a `video_processing` row stuck past 10 minutes is treated as failed rather than left stranded forever. No-ops with zero DB writes when no org has connected ElevenLabs. Deliberately **excluded** from `verify:jobs`, same reasoning as `clay-enrichment` — a live run spends a connected org's own paid ElevenLabs credits |
| ✅ | `/ugc-videos` | Brief + optional property tag + required voice ID + a required presenter photo upload in, a `status: "pending"` row out — generation is entirely the worker job's responsibility, never awaited inside the request/response cycle. Refuses to insert the row (with a link to Settings → Integrations) if the org has no active ElevenLabs connection, rather than accepting a brief that can never advance past `pending`. List shows every video with a status badge and an inline player once `ready` |
| ✅ | `/ugc-videos/[id]` | Script, video player, and the queue-for-posting form (platform, caption, optional target date) once `ready`; existing queue entries with mark-posted/cancel actions |
| ✅ | Capability | New `can.manageUgcVideos` (member tier) — same trust tier as `manageCrm`/`writeAnalysis` for *using* an already-connected account; connecting/revoking the ElevenLabs credential itself is `manageIntegrations` (admin+), the same split every other provider draws between "connect it" and "use it" |
| ⬜ | MCP tools | Not exposed — generation spends real money per call, same reasoning integrations' write actions stay out of MCP's reach (§13) |
| ⬜ | Automated posting | Deliberately out of scope until Postiz (§13's queued third integration) lands. The post queue exists so a finished video isn't lost track of while that's built, not so it can fire anywhere today |
| ⬜ | Durable video storage | `videoUrl` is ElevenLabs' own hosted URL; its retention window isn't confirmed. Mirroring finished videos into an object store is a natural follow-up once Falorb has one for any feature, not something to stand up solely for this |
| 🟡 | Verified | Typechecks and builds; never exercised against a live ElevenLabs connection — no live account was available to confirm the Flows video API's actual completed-generation response shape (see the client's caveat above) or the `creatify-aurora` request contract end to end |

---

## Backend surface not yet in the dashboard

Audited by enumerating every schema table and every query-layer export, then
checking what `apps/web` actually references. The dashboard is **not** a
complete front end for the backend; these are the gaps, in the order they cost
the most.

| Backend | State | What is missing in the UI |
|---|---|---|
| `segments` | table + `segment-counts` worker | People can be filtered but not *saved* as a segment; the worker caches sizes for segments that cannot be created. No condition-tree filter builder exists anywhere in the app yet — the People page's filter bar is a flat search+checkbox, not the `Filter[]` AST `compileFilters`/`refreshSegmentCounts` already expect |
| `dashboardWidgets` | table | The design system's custom-view builder (widget grid) is not built; `/insights` is a single fixed layout |

`dataRequests`, `webhooks`, `consentRecords`, `auditLog` and `personMerges` are
now built — see §18. `closedSessions` was removed from this list: it's a
worker-internal ingestion query (`sessionizer.ts`/`backfill.ts` roll closed
sessions into Postgres totals against raw `events`) with different
correctness requirements than the UI's own `sessionList` (which reads
`events_v` live, so identity merges are reflected) — not a missing frontend
feature, just a different consumer.

`funnels` and `insights` are now built: the funnel builder has a "Save"
button (`apps/web/src/server/actions/funnels.ts`) alongside the existing
read path (`listFunnels`/`SavedFunnels.tsx`), and the cross-project builder
gained the same for the pragmatic scope it actually has today — metric,
dimension, chart, property selection (`apps/web/src/server/actions/insights.ts`,
`SavedInsights.tsx`) — not the fuller `kind`/query vocabulary the `insights`
schema leaves room for later. Verified live: saved and deleted both, in both
places.

Auth internals (`account`, `session`, `verification`) are managed by better-auth
and correctly have no UI.

## Known defects

1. **The seed attaches no account.** `pnpm db:seed` creates the properties but
   no membership, so a fresh signup sees an empty portfolio while every seeded
   person sits in an organization nobody belongs to. The seed now says so and
   takes `SEED_OWNER_EMAIL=you@example.com` to fix it, but it cannot do it
   unprompted — the account has to exist first.
2. **`BETTER_AUTH_SECRET` is a low-entropy placeholder.** better-auth warns on
   every boot. It signs session cookies, so rotating it signs everyone out —
   change it before the first real account. `openssl rand -base64 32`.
3. **The e2e suite needs `FALORB_AUTH_RATE_LIMIT=off`.** Set by
   `playwright.config.ts` for its own server. A run legitimately spends more
   sign-in attempts than the production limit allows (5 sign-ups an hour, 5
   sign-ins per five minutes, per IP), so without it consecutive runs throttle
   themselves and fail on auth — which looks like a broken dashboard. The limits
   themselves are correct and unchanged for real deployments.
4. **`Tooltip` has the clipping bug `Select` just had.** It positions absolutely
   inside its trigger, so inside a `Card` (`overflow: hidden`) it is cut off. Not
   currently used by the dashboard, so it is latent rather than visible; the fix
   is the same portal treatment.

### Fixed

- ~~**The overview silently excluded today.**~~ `date < toDate(to)` dropped the
  current day from the portfolio overview, sparklines, retention and stickiness
  — a new project with real traffic reported "no data". Fixed with `chDateEnd()`.
- ~~**Cross-domain link stitching was inert.**~~ The token round-tripped into
  storage but nothing consumed it. Now validated at ingest and stitched by the
  resolver.
- ~~**Cross-domain stitching required a closed session.**~~ Found while testing
  the fix above: a click-through happens seconds after browsing the source
  site, so no alias existed yet and the link was dropped in the *common* case.
  The resolver now adopts the source device from ClickHouse.
- ~~**`geoip:download` pointed at a script that did not exist.**~~
- ~~**No historical backfill.**~~ `apps/worker/src/backfill.ts`.
- ~~**No email delivery.**~~ Resend, with SMTP and log fallbacks.
- ~~**`props_raw` escaped PII masking.**~~ Caught while wiring masking: the
  verbatim payload shown in the event detail view was built from the *unmasked*
  props, preserving exactly what masking had just removed.

## 18. Trust & ops surfaces — GDPR requests, audit log, webhooks, consent log, person merge

The five highest-cost items from the old "Backend surface not yet in the
dashboard" list — each already had a complete backend (a worker, a full API
route, or just a written-to-but-unread table) and needed only UI wired onto
it.

| | Feature | Notes |
|---|---|---|
| ✅ | GDPR data requests | `/people/[personId]`'s new "Data requests" card. Duplicates `POST/GET /requests` in `apps/api/src/routes/people.ts` directly against `dataRequests` (same reasoning as every other action in `apps/web/src/server/actions`), gated `manageProject`. Verified live: requested an export, ran `processDataRequests` (`apps/worker/src/jobs/retention-gc.ts`) via `verify:jobs`, confirmed the card flipped to "completed" |
| ✅ | Audit log viewer | `/settings/audit-log` — `listAuditLog` (new, paginated, actor joined from `user`) + an action-name filter sourced from `AUDIT_ACTIONS`. Readable by any workspace member, matching `/settings/team`'s read-open convention |
| ✅ | Webhooks | `/settings/webhooks` — register/delete/enable-disable an `ops.webhooks` endpoint (distinct from an alert channel's webhook destination). Triggers are goal names, shown as clickable reference chips sourced from each property's real `listGoals`, not a blind text field. Secret shown once on creation, same UX as API key issuance. Gated `manageProject` |
| ✅ | Consent log | `/p/[project]/consent-log`, linked from the property's Settings tab next to the consent-mode field (which was also carrying a stale warning — "server-side enforcement is not implemented yet" — contradicted by §3's actual `apps/ingest/src/consent.ts`; corrected in the same edit) |
| ✅ | Person merge/unmerge | New "Merge duplicate profile" card on `/people/[personId]`: search (reuses `listPeople`'s existing search), merge, and a reversible history list with an unmerge button. Duplicates `POST /merge` / `POST /unmerge/:mergeId` in `apps/api/src/routes/people.ts`, gated `manageProject`. **Found and fixed a real bug while verifying this live**: interpolating a plain JS array (`merged.projectIds`) or `Date` (`merged.firstSeenAt`) directly into a drizzle `sql` template isn't reliably bound by this project's postgres.js setup — every merge attempt with a non-empty `projectIds` crashed. Fixed here by building the array/timestamp as an explicit SQL literal (`ARRAY[...]::integer[]`, `::timestamptz`), the same pattern already used correctly elsewhere (`identity-resolver.ts`'s other three `unnest()` calls, `backfill.ts`, `sessionizer.ts`). The identical bug still exists in `apps/api/src/routes/people.ts`'s `/merge` route and in `identity-resolver.ts`'s own automatic-merge path (line ~437) — flagged as a follow-up, not fixed here, since it's outside this branch's scope |
| ✅ | Verified | Full monorepo typecheck + test suite, production build, and a live walkthrough of every item above against the dev stack, including the merge/unmerge round trip end to end (search → merge → totals updated correctly → unmerge → row restored) |
| 🟡 | Playwright coverage | Verified manually as above; no automated coverage yet, same gap as every other dashboard feature in this document |

## Suggested next order

1. Fix defect 1 (`SEED_OWNER_EMAIL`) and rotate `BETTER_AUTH_SECRET`, in that
   order — the first makes the dashboard show data, the second is cheap now and
   expensive after real accounts exist.
2. Apply §18's merge-bug fix to `apps/api/src/routes/people.ts` and
   `identity-resolver.ts` — the automatic merge path runs continuously in
   production and may be silently erroring right now.
3. Saved funnels (mostly built — only save/delete is missing), then saved
   insights, then segments (the one genuinely new UI: a condition-tree filter
   builder doesn't exist anywhere yet).
4. The custom-view widget builder — depends on saved insights existing first.
5. Coolify deploy, then instrument the primary site first.
