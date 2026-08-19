# Falorb — Feature Status

Living record of what exists, what is half-built, and what has not been started.

**Last updated:** 2026-08-18

| Status | Meaning |
|---|---|
| ✅ | Built **and verified running** — evidence noted |
| 🟡 | Partially built — the gap is stated explicitly |
| ⬜ | Not started |
| 📋 | Designed only — deliberately not implemented yet |

**Where things stand:** the collection pipeline, storage layer, identity graph,
query layer, background workers, MCP server and self-serve account system are
complete and verified. The dashboard is built — 32 routes on the Falorb design
system, light and dark, role-enforced. Most routes are driven end to end by
Playwright; the eight newest — sales lead actions, the weekly digest, the
product signal's drop-off data, the public benchmark report, the referral
incentive layer, content auto-drafting, the embeddable badge and the
referral-boosted waitlist (§14e–§14j below) — are verified manually
(typecheck, production build, and live requests against the dev stack) and
not yet in that suite. It does
not yet cover the whole backend: see *Backend surface not yet in the dashboard*.
The integrations layer is design-only. Verification commands are in
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

13 of the 14 below verified running via `pnpm --filter @falorb/worker verify:jobs`; `digest` (new) typechecks and doesn't touch its siblings, but isn't in that runner yet since exercising it live sends real email and makes a real OpenRouter call.

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

Next.js 15 App Router on React 19, built on the Falorb design system. **32
routes, production build passing, and an end-to-end suite that drives most of
them in a browser** (`pnpm --filter @falorb/web e2e`, 41 tests — the eight
newest routes are verified manually via typecheck/build/live curl, not yet in
that suite; see §14d–§14j). Server components call
`@falorb/queries` directly — no HTTP hop between the dashboard and the query
layer.

| | Route | Purpose |
|---|---|---|
| ✅ | `/` | All-properties overview — stat strip, per-property sparkline + delta |
| ✅ | `/p/[project]` | Property summary — totals, visitors/sessions trend, four breakdowns |
| ✅ | `/p/[project]/live` | Realtime feed, pages and countries now, longest-on-site |
| ✅ | `/p/[project]/people` | Person list — debounced search, identified filter, sort, paging |
| ✅ | `/people/[personId]` | **Deep profile** — cross-property timeline, products used, acquisition chain, interests, aliases |
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
| ✅ | `/alerts` | Delivery channels, rules, firing history |
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
| ✅ | Own subdomain for shared links | `referralLinkUrl()` now prefers `FALORB_REFERRAL_URL` (e.g. `referral.<domain>`) over `FALORB_APP_URL`, so a link someone actually shares doesn't read as the internal dashboard's own address — same app, same `/r/[code]` route, `infra/Caddyfile`/Coolify just proxy the extra hostname to it. Falls back to `FALORB_APP_URL` when unset |
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
| ✅ | Owner view | `/p/[project]/waitlist` — enable/disable, the join link, a ranked entrant table with referral counts |

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

---

## Backend surface not yet in the dashboard

Audited by enumerating every schema table and every query-layer export, then
checking what `apps/web` actually references. The dashboard is **not** a
complete front end for the backend; these are the gaps, in the order they cost
the most.

| Backend | State | What is missing in the UI |
|---|---|---|
| `dataRequests` | worker processes them | No way to raise a GDPR export or erasure. The `data-requests` job runs every 2m against rows nothing creates |
| `segments` | table + `segment-counts` worker | People can be filtered but not *saved* as a segment; the worker caches sizes for segments that cannot be created |
| `funnels` | table | The funnel builder is URL-only. Nothing saves a funnel, so one cannot be shared by name or reused in an alert |
| `insights` | table | Same for the cross-project builder — the query lives in the URL and nowhere else |
| `dashboardWidgets` | table | The design system's custom-view builder (widget grid) is not built; `/insights` is a single fixed layout |
| `webhooks` | table + dispatcher job | No UI to register an endpoint or see delivery history |
| `consentRecords` | ingest writes them | No UI to read the consent log |
| `auditLog` | API writes it | No UI to read it. Written on project, key, member and person actions and visible only in Postgres |
| `personMerges` | resolver writes it | Merge/unmerge exists in the API; the person profile cannot trigger or reverse one |
| `closedSessions` | query exists | Not consumed — the session list uses `sessionList` |

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

## Suggested next order

1. Fix defect 1 (`SEED_OWNER_EMAIL`) and rotate `BETTER_AUTH_SECRET`, in that
   order — the first makes the dashboard show data, the second is cheap now and
   expensive after real accounts exist.
2. Close the highest-cost integration gaps: GDPR data requests, then saved
   segments and funnels. Each has a worker or a table already waiting on a UI.
3. Audit log and consent log viewers — both are written today and readable only
   in Postgres, which is the wrong place to look during an incident.
4. Webhook management, then the custom-view widget builder.
5. Coolify deploy, then instrument the primary site first.
