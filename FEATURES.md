# Falorb — Feature Status

Living record of what exists, what is half-built, and what has not been started.

**Last updated:** 2026-08-16

| Status | Meaning |
|---|---|
| ✅ | Built **and verified running** — evidence noted |
| 🟡 | Partially built — the gap is stated explicitly |
| ⬜ | Not started |
| 📋 | Designed only — deliberately not implemented yet |

**Where things stand:** the collection pipeline, storage layer, identity graph,
query layer, background workers, MCP server and self-serve account system are
complete and verified. The dashboard now exists — 20 routes, building and
typechecking, built on the Falorb design system — but only its signed-out
screens have been exercised in a browser. The integrations layer is design-only.
Verification commands are in [README.md](README.md).

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
| ✅ | **Cross-domain link stitching** | Token validated at ingest (where the freshness window is meaningful), then stitched by the resolver. Verified: an anonymous visitor clicking obhox→linkbry becomes one person across both |
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

## 7. Workers — `apps/worker`

**All 11 verified running** (`npx tsx apps/worker/src/verify-jobs.ts`).

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
| ✅ | 101 unit tests | core 45, ingest 28, queries 21, worker 7 |
| ✅ | Injection-safety suite | Prototype pollution, wildcard leakage, param binding |
| ✅ | Query smoke runner | 32 queries against live ClickHouse |
| ✅ | Job verifier | Runs all 11 jobs once |
| ✅ | Tracker size gate | |
| ✅ | Load test | `scripts/loadtest.mjs` — asserts every acknowledged event reached ClickHouse |
| ⬜ | Playwright end-to-end | Browser → dashboard funnel assertion |
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

## 13. Integrations — 📋 design only

Requested as planning, **not built**. Recorded here so the design is settled
before any code exists.

### Shape

Two directions, and they are not symmetrical:

**Inbound** — other services send data *in*, enriching the person graph.
A Stripe payment or a HubSpot deal should attach to the same person the
tracker already knows, which means every inbound integration resolves to an
existing identity or creates one. That resolution is the hard part, and the
existing `person_aliases` graph is the right place for it: an integration
becomes another alias kind alongside `device` and `identify`.

**Outbound** — Falorb pushes data *out* (reverse-ETL): a segment of
high-intent people to a CRM, a conversion to an ad platform. These are
scheduled syncs over a segment definition, so they build on `segments`.

### Proposed schema

| Table | Purpose |
|---|---|
| `integrations` | One row per connected service: org, kind, status, config, encrypted credentials |
| `integration_syncs` | Run history — started, finished, records in/out, error |
| `integration_mappings` | Field mapping between the external object and Falorb's person/company |

`person_aliases.kind` gains values like `stripe_customer`, `hubspot_contact`,
so an external id is resolved through the same graph as a device id.

### Candidate integrations

| Priority | Service | Direction | Why |
|---|---|---|---|
| 1 | **Stripe** | in | Real revenue per person, replacing tracker-reported `revenue()`. Highest value for a SaaS portfolio. |
| 1 | **Slack** | out | Alert delivery — the channel already exists in `alert_channels`, only the connect flow is missing |
| 2 | **HubSpot / Attio** | both | Push high-intent people to the CRM; pull deal stage back for closed-loop attribution |
| 2 | **Generic webhooks** | out | Already has a table and HMAC helper; needs the dispatcher job |
| 3 | **Google Search Console** | in | Query-level SEO data joined to on-site behaviour |
| 3 | **Shopify** | in | Orders, for the commerce case |
| 4 | **Zapier / n8n** | out | Long tail, without building each one |

### Design constraints, decided now

- **Credentials encrypted at rest**, never returned by an API. The `api_keys`
  hashing approach does not transfer — OAuth tokens must be decryptable to be
  used, so this needs envelope encryption with a key outside the database.
- **Every integration is per-organization**, resolved through the same scope
  boundary as everything else.
- **Inbound writes go through the identity graph**, never straight to
  ClickHouse — otherwise a Stripe customer becomes a second person who never
  merges with their web activity.
- **Sync failures must be visible.** `integration_syncs` exists so a silently
  broken connection surfaces, rather than looking like "no new customers".
- **MCP exposure**: once built, integrations get read tools
  (`list_integrations`, `get_sync_status`) but connect/disconnect stays a
  dashboard action, in line with the destructive-tools boundary above.

### Not planned

Anything that ships personal data to an ad network for cross-site retargeting.
That would reintroduce, through a side door, exactly the tracking this platform
deliberately does not do.

## 14. Dashboard — `apps/web`

Next.js 15 App Router on React 19, built against the Falorb design system.
**20 routes compile and the production build passes** (`pnpm --filter
@falorb/web build`). Server components call `@falorb/queries` directly — no
HTTP hop between the dashboard and the query layer.

**Not yet verified in a browser while signed in.** The sign-in and sign-up
screens were exercised against the running app and the auth gate redirects
correctly; every authenticated screen is typechecked and builds, but has not
been rendered with a live session. See *Known defects* — the seeded properties
belong to an organization with no members, so a fresh signup lands on an empty
portfolio until a membership row is added.

| | Route | Purpose |
|---|---|---|
| 🟡 | `/` | All-properties overview — stat strip, per-property sparkline + delta |
| 🟡 | `/p/[project]` | Property summary — totals, visitors/sessions trend, four breakdowns |
| 🟡 | `/p/[project]/live` | Realtime feed, pages and countries now, longest-on-site |
| 🟡 | `/p/[project]/people` | Person list — debounced search, identified filter, sort, paging |
| 🟡 | `/people/[personId]` | **Deep profile** — cross-property timeline, products used, acquisition chain, interests, aliases |
| 🟡 | `/p/[project]/funnels` | URL-encoded builder + drop-off waterfall |
| 🟡 | `/p/[project]/paths` | Sankey + entry/exit/frustration reports |
| 🟡 | `/p/[project]/retention` | Cohort grid + stickiness distribution |
| 🟡 | `/p/[project]/events` | Event explorer with per-event filtering and session list |
| 🟡 | `/p/[project]/goals` | Goals CRUD + conversions + three attribution models |
| 🟡 | `/p/[project]/settings` | Snippet, domains, timezone, identity scope, consent, retention |
| 🟡 | `/settings`, `/settings/new` | Instance settings; add a property |
| 🟡 | `/insights` | Cross-project builder — metric × dimension × chart, people across products |
| 🟡 | `/alerts` | Rule management matching the worker's condition shapes, plus firing history |
| ✅ | Auth | better-auth mounted same-origin at `/api/auth`; config shared with the API via `@falorb/auth`. Sign-in, sign-up and the redirect gate verified in a browser |
| 🟡 | SSE live streaming | `/api/live/[project]`, 3s poll, cursor-advanced, 30-min self-close |
| 🟡 | Charts | Design system's own chart set — no chart library added |

**Two design-system fixes were needed for SSR** and are noted in
`packages/ui/src/index.jsx`: `Sparkline` and `LineChart` derived their SVG
gradient ids from `Math.random()`, which differs between the server and client
render passes and breaks hydration; both now use `React.useId()`. `Icon` was
switched from the Lucide CDN sprite to the bundled `lucide-react` so glyphs are
present in the first paint.

## 14a. Design system — `packages/ui`

| | Feature | Notes |
|---|---|---|
| ✅ | 32 components ported | core, forms, navigation, feedback, data, charts — copied from `Design System/`, not rewritten |
| ✅ | 9 token files | Imported through one `styles.css` entry point |
| ✅ | Fonts self-hosted | `next/font` replaces the Google Fonts CDN link, so tabular figures do not arrive late and reflow number columns |
| ✅ | Types under React 19 | `.d.ts` return types moved to `React.JSX.Element` |
| ⬜ | Sync tooling | Re-copying from `Design System/` is manual; the four deliberate deltas must be re-applied by hand |

## 15. SDKs

| | Package | Notes |
|---|---|---|
| ✅ | `packages/sdk-node` | Non-blocking, never throws, batches by identity. 12 tests |
| ✅ | `packages/sdk-react` | `<FalorbProvider>`, `useFalorb`, `usePageview`, `useIdentify`. Customer-facing library — **not** the dashboard |

## 16. Deployment

| | Feature | Notes |
|---|---|---|
| ✅ | Local Docker Compose | Verified cold start |
| ⬜ | Coolify deployment | `a.obhox.com` → ingest, `analytics.obhox.com` → web |
| ✅ | Caddy config | `infra/Caddyfile` — collector, dashboard and MCP on separate hostnames |
| ✅ | Backups | `infra/backup.sh` — incremental ClickHouse, verified gzip for Postgres |
| ⬜ | Rollout to the 10 live sites | obhox, linkbry, letternerd, spendtab, usebund, patrio, wardrobe, falorb |

---

## Known defects

None outstanding. Everything previously listed here is fixed and verified.

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

## Suggested next order

1. **Sign in and walk the dashboard.** Fix defect 5 first (the membership row),
   or every screen renders an honest but empty state. This is the only thing
   standing between "builds" and "verified".
2. Rotate `BETTER_AUTH_SECRET` (defect 6) before any real account exists.
3. Close the remaining defects — three are silent failures.
4. Playwright end-to-end over the dashboard, so the signed-in screens stay
   verified rather than being re-checked by hand.
5. Webhook dispatcher + goal evaluator.
6. Integrations, starting with Stripe (revenue) and Slack (alert delivery).
7. Coolify deploy, then instrument obhox.com first.
