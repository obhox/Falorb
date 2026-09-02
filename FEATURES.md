# Falorb — Feature Status

Living record of what exists, what is half-built, and what has not been started.

**Last updated:** 2026-08-21

| Status | Meaning |
|---|---|
| ✅ | Built **and verified running** — evidence noted |
| 🟡 | Partially built — the gap is stated explicitly |
| ⬜ | Not started |
| 📋 | Designed only — deliberately not implemented yet |

**Where things stand:** the collection pipeline, storage layer, identity graph,
query layer, background workers, MCP server and self-serve account system are
complete and verified. The dashboard is built — 38 routes on the Falorb design
system, light and dark, role-enforced. Most routes are driven end to end by
Playwright; the newest — sales lead actions, the weekly digest, the product
signal's drop-off data, the referral incentive layer and content
auto-drafting (§14d–§14h below) — are verified
manually (typecheck, production build, and live requests against the dev
stack) and not yet in that suite. It does not yet cover the whole backend:
see *Backend surface not yet in the dashboard*. Verification commands are in
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
| ✅ | Manual merge / unmerge API | `POST /api/people/merge` and `/unmerge/:id`; reversible from the audit snapshot. Also in MCP — `merge_people`/`unmerge_people` (§11) |
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
| ✅ | 325 unit tests | core 110, ingest 61, ai 55, queries 30, agents 26, sdk-node 12, web 9, worker 7, mcp-connector 6, db 5, research 4 |
| ✅ | Injection-safety suite | Prototype pollution, wildcard leakage, param binding |
| ✅ | Query smoke runner | 32 queries against live ClickHouse |
| ✅ | Job verifier | Runs all 11 jobs once |
| ✅ | Tracker size gate | |
| ✅ | Load test | `scripts/loadtest.mjs` — asserts every acknowledged event reached ClickHouse |
| ✅ | Playwright end-to-end | 41 tests over every dashboard route, signed in against real Postgres and ClickHouse. `pnpm --filter @falorb/web e2e` |
| ✅ | CI pipeline | Typecheck, tests, size gate, then migrations + queries + jobs + load test + MCP against real services |

## 11. MCP server — `apps/mcp`

Lets any MCP-capable assistant query **and run** the platform directly. **144
tools, 2 resources, 3 prompts** (`pnpm --filter @falorb/mcp smoke` exercises
every tool against a real MCP client, including that every local-operator-
only tool below is genuinely refused to a bearer key).

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
| ✅ | Scoped write tools throughout | Most write tools (goals, alerts, referrals, sharing, team, tasks, agents) require only the `write` scope — a read-only key cannot call any of them |
| ✅ | **Local-operator-only tools** | A second, narrower gate (`requireLocalOperator`) on top of `write`, for the handful of actions the dashboard's own bearer-key-facing API refuses to *every* API key with no scope exception: connecting/testing/revoking/rotating an integration credential, and GDPR person erasure. Verified: a bearer key with full `write` scope is still refused all five |
| ✅ | Integration tools | `get_integration_status` (read, any scope) — connected/healthy/last-verified per provider, never the credential itself. `connect_integration`, `test_integration_connection`, `revoke_integration_connection`, `set_integration_model` (local operator only) — store, verify, rotate, or clear a credential, org- or property-scoped |
| ✅ | Task-board tools | `list_tasks`, `get_task`, `create_task`, `update_task`, `assign_task`, `set_task_status`, `comment_on_task`, `delete_task` — the same `tasks`/`task_comments` tables the dashboard and the agent runtime both use; assigning to an agent starts its shift within a minute via the worker's existing sweep |
| ✅ | AI-employee tools | `list_agents`, `get_agent`, `hire_agent`, `update_agent`, `set_agent_status`, `retire_agent`, `run_agent_now`, `list_agent_runs`, `get_agent_run`, `list_agent_errors` (the cross-agent error log), `list_agent_approvals`, `decide_agent_approval`, `list_agent_grants` (active time-boxed approval waivers), `set_automation_paused`/`get_automation_state` (the workspace kill switch and its read side). An agent hired or edited through this server is capped at role "member" — never admin/owner — since a write-scope key carries no per-human role for `canGrantAgentRole` to check against |
| ✅ | `archive_project` | The one project-lifecycle action there is — there is no hard delete anywhere in this codebase, so a write-scope key may do it like any other write |
| ✅ | Person export/erasure | `request_person_export` (write scope), `request_person_erasure` (local operator only, mirroring `requireHumanSession` on `POST /api/people/requests`'s `delete` kind) |
| ✅ | Merge/unmerge | `merge_people`, `unmerge_people` (write scope) — the same reversible-via-snapshot mechanism `POST /api/people/merge`/`/unmerge/:id` expose, including the array/timestamp `sql` literal fix (§18) |
| ✅ | Resources | `falorb://projects`, `falorb://capabilities` |
| ✅ | Prompts | `weekly_review`, `conversion_audit`, `lead_research` |
| ✅ | LLM-shaped output | Markdown tables, pre-formatted numbers, relative times |
| ✅ | Flexible ranges | `7d`, `24h`, `today`, `mtd`, `2026-08-01..2026-08-16` |
| ✅ | Injection-safe | Verified: `evil; DROP TABLE events` rejected as a dimension |
| ✅ | Server instructions | Steer the model away from guessing event names and from overclaiming |
| ⬜ | OAuth for MCP | Currently bearer API keys only; fine for connectors that accept a token |
| ✅ | Hard delete stays unreachable, because it doesn't exist | There is no hard delete anywhere in this codebase — `archive_project` is genuinely the whole capability, dashboard included, so exposing it is not a new risk. Person erasure is the one true irreversible action, and it is gated to the local operator only (`requireLocalOperator`), never a bearer key, matching `requireHumanSession` on the dashboard's own API — an assistant connected over a remote/hosted bearer key can never erase a person; one running locally over stdio already holds the database credentials to do so directly, so the gate adds no protection there and isn't asked to |

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

## 13. Integrations — MCP servers, web research, and the AI gateways

Three things Falorb calls out to, all optional, all per-organization: a
web-research provider (§14h), the AI gateway every AI feature runs on
(OpenRouter, Ramp Router or Google Gemini), and — the generic path — any
remote MCP server.

Bespoke REST connectors per service (a HubSpot client, a Slack client, …)
remain deliberately unbuilt: each is a hand-written client, a mirror schema,
a sync job and a dashboard surface, and the platform accumulated and then
shed several of them. MCP is the opposite shape: one standard protocol, so
supporting it once means an organization can connect *any* compliant server —
its own internal tools, Notion, anything — without Falorb writing a line of
code per service. `apps/mcp` is Falorb acting as an MCP *server*; this is the
reverse, Falorb acting as an MCP *client*. A connected server's tools are
never known ahead of time, so `@falorb/mcp-connector` exposes
`listTools()`/`callTool()` straight from the server's own `tools/list`.

- **Schema** — `mcp_connections` (`packages/db/src/schema/mcp.ts`), not a new
  `integration_connections` provider: an organization can connect arbitrarily
  many, arbitrarily named servers (a "Notion" server, an "internal tools"
  server), a cardinality that table's one-row-per-provider uniqueness doesn't
  fit. Same AES-256-GCM-at-rest convention, except the credential columns are
  nullable — some MCP servers need no auth at all. Each row caches its last
  `tools/list` result (`toolsCache`/`toolsCachedAt`) so a read doesn't cost a
  live round trip every time.
- **Client** — `packages/mcp-connector`, `McpConnectorClient`: connects over
  Streamable HTTP, falling back to the older SSE transport if that fails
  (both ship in `@modelcontextprotocol/sdk`, no new dependency); `listTools`,
  `callTool`, `verifyConnection` (lists tools — the cheapest authenticated
  call that proves the connection works).
- **Agent toolkit** — `@falorb/agents`'s new `mcp` toolkit
  (`packages/agents/src/tools/mcp.ts`) has exactly two tools, not one per
  discovered remote tool. `packages/agents` has a hard invariant that every
  tool name is resolvable from one static, global registry forever —
  `executeApproval` (`run.ts`) resumes a queued approval by looking a tool up
  **by name**, potentially long after the shift that raised it has ended,
  possibly in a different worker process. A tool synthesized fresh per remote
  server, per shift, would not exist for that lookup to find, and since every
  MCP call is graded `external` (see below) — and so will very often need
  approval — that is not an edge case. `list_mcp_tools` (read) is how an
  agent discovers what a connected server actually offers and each tool's
  argument schema, the substitute for per-tool function schemas a static
  registry can't provide here; `call_mcp_tool` (external,
  `actOnIntegrations`) is the one, always-resolvable path every call goes
  through, reconstructing the connection and the real tool name from stored
  ids rather than any in-memory state.
- **Grading is deliberately uniform, not clever** — every `call_mcp_tool`
  call is graded `external` regardless of what the remote tool actually
  does, because Falorb has no way to know whether a given server's tool
  reads or deletes something. An admin who trusts a specific server waives
  that the same way as any other toolkit: `autoApproveTools: ["toolkit:mcp"]`
  or `"*"`.
- **Falorb's own MCP server** — `apps/mcp/src/tools/mcp-connections.ts`
  (`list_mcp_servers`, `connect_mcp_server`, `test_mcp_server_connection`,
  `revoke_mcp_server_connection`), same shape as `tools/integrations.ts`:
  reads are open, writes require `requireLocalOperator` — connecting a
  credential is a materially different, higher-trust act than using one
  already connected, refused to every bearer API key the same way the
  dashboard's own API refuses it.
- **Dashboard** — Settings → Integrations gained an "MCP servers" panel
  (`McpServersPanel.tsx`) alongside the existing per-provider one: connect
  (name, URL, optional token), test, revoke. Org-level only, no per-project
  override — an MCP connection is a service credential, not a per-property
  preference, unlike the AI gateways. No
  manual tool-call inspector — a human can see what's connected and its tool
  count, but only an agent actually calls a tool.
- **Explicit limitations, not silently designed around**: bearer-token auth
  only, no OAuth/dynamic client registration; remote (HTTP/SSE) transport
  only, no stdio/local-process servers — a multi-tenant hosted backend
  can't safely run an arbitrary org-supplied local command; any agent
  holding the `mcp` toolkit can call any server the org has connected
  (no per-agent server picker — a real, separate follow-up if ever wanted).

## 14. Dashboard — `apps/web`

Next.js 15 App Router on React 19, built on the Falorb design system. **33
routes, production build passing, and an end-to-end suite that drives most of
them in a browser** (`pnpm --filter @falorb/web e2e`, 41 tests — the newest
routes are verified manually via typecheck/build/live curl, not yet in that
suite; see §14d–§14h). Server components call
`@falorb/queries` directly — no HTTP hop between the dashboard and the query
layer.

| | Route | Purpose |
|---|---|---|
| ✅ | `/` | All-properties overview — stat strip, per-property sparkline + delta |
| ✅ | `/p/[project]` | Property summary — totals, visitors/sessions trend, four breakdowns |
| ✅ | `/p/[project]/live` | Realtime feed, pages and countries now, longest-on-site |
| ✅ | `/p/[project]/people` | Person list — debounced search, identified filter, sort, paging |
| ✅ | `/people/[personId]` | **Deep profile** — cross-property timeline, products used, acquisition chain, interests, aliases. |
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
| ✅ | `/p/[project]/settings` | Snippet, public link, domains, timezone, identity scope, consent, retention |
| ✅ | `/settings` | Instance settings — properties, endpoints (now including the referral-link origin, see §14d), workspace, weekly digest opt-out (§14f) |
| ✅ | `/settings/team` | Members, roles, invitations |
| ✅ | `/settings/mcp` | API keys + MCP connection config |
| ✅ | `/settings/new` | Add a property |
| ✅ | `/insights` | Cross-project builder — metric × dimension × chart, people across products |
| ✅ | `/alerts` | Delivery channels, rules, firing history |
| ✅ | `/share/[token]` | Public read-only property summary |
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
| ✅ | Own subdomain for shared links | `referralLinkUrl()` prefers `FALORB_REFERRAL_URL` (e.g. `refer.<domain>`) over `FALORB_APP_URL`, so a link someone actually shares doesn't read as the internal dashboard's own address — same app, same `/r/[code]` route, `infra/Caddyfile`/Coolify just proxy the extra hostname to it. Falls back to `FALORB_APP_URL` when unset. |
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
| ✅ | Model selection | Defaults to `"openrouter/auto"` (OpenRouter picks per request) rather than pinning one; `OPENROUTER_MODEL` overrides with a single model or a comma-separated fallback list. An organization that has connected its own gateway (§13) chooses its own model instead, and that choice wins over this env var |
| ✅ | Plain-text output, guaranteed | A prompt instruction against markdown is not reliable on its own — verified live that models still reach for `**bold**` and `##` headers — so `stripMarkdown` strips it programmatically after generation. Deliberately skips underscore-based emphasis: the context data is full of snake_case field names (`utm_source`, `content_tag`) the model echoes back, and a naive single-underscore rule would merge two unrelated words together |
| ✅ | Graceful failure | No credentials at all (neither a connected gateway nor `OPENROUTER_API_KEY`), an unreachable upstream, an empty response, a rejected key, and a real `402` (insufficient OpenRouter credits, hit live during testing) all surface as a clear toast, never a crash |
| ✅ | Shared across web and worker | The gateway call, prompts and markdown-stripping moved to their own package, `packages/ai` — not `@falorb/core`, which is documented as pure/browser-safe and gets bundled into the client; a secret-holding network call must never live there. `apps/web/src/server/ai.ts` re-exports it behind the app's server-only boundary; `apps/worker`'s digest job (§14f) imports it directly |
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

## 14g. Content auto-draft — `/p/[project]/content`

The Content page's "rising interest, thin coverage" rows used to be a table
to read and act on manually. A button now drafts an actual page for that
topic via OpenRouter, stored for the owner to copy elsewhere — there is no
CMS integration, so this stops at drafting, not publishing.

| | Feature | Notes |
|---|---|---|
| ✅ | One-click draft per topic | `draftContentPage` action, `content_drafts` table (`title`, `metaDescription`, markdown `body`, the source `topic` and interest context) |
| ✅ | Markdown preserved | `@falorb/ai`'s `complete()` strips markdown by default for prose signals; this caller passes `stripMarkdown: false` (an additive option) since the output is meant to stay markdown |
| ✅ | Draft viewer | `/p/[project]/content/drafts/[id]`, three copyable fields (title, meta description, body) plus a list of past drafts on the Content page |

## 14h. Web research — Firecrawl

A per-organization connection through Settings → Integrations (§13) —
connected from `IntegrationsPanel.tsx`, stored in `integrationConnections`,
no platform-wide key. Grounds two existing AI features in real web content
instead of the LLM's own guesses.

| | Feature | Notes |
|---|---|---|
| ✅ | `packages/research` | `FirecrawlClient` plus the `search`/`fetchPage` orchestration every feature actually calls. `FIRECRAWL_DEFAULT_BASE_URL` is supplied server-side, so the connect dialog asks only for an API key, no base URL. `verifyConnection()` is the free `GET /v1/team/credit-usage` (no credits spent, unlike scrape/search) — verified live against a real account, including the 401 path for a bad key |
| ✅ | One provider, not a fallback chain | This was Exa-primary-for-search, Firecrawl-primary-for-scrape, each the other's fallback. Firecrawl does both, and the second provider bought one more credential to configure, test and debug for a capability already covered — `search()`/`fetchPage()` now call the one connected client and raise `ResearchUnavailableError` when there isn't one |
| ✅ | Content drafts research | `draftContentPage` (§14g) calls `researchTopic` first: a web search for the topic sees what already ranks, folded into the OpenRouter prompt so the draft is differentiated rather than a generic overview. Falls back to the interest-data-only prompt if the organization hasn't connected Firecrawl or the call errors — never blocks the draft |
| ✅ | Company research | "Research this company" action on the person profile's Company card (`CompanyResearchCard.tsx`, `enrichCompany` action) — fills `companies.industry`/`employeeRange`/`linkedinUrl`, fields the automatic ASN-based enrichment job (§4, `apps/worker/src/jobs/enrichment.ts`) never populates since it only ever learns a network operator's registered name. A scrape of the company's own homepage feeds one short OpenRouter call that extracts only what the content actually states — told explicitly to leave a field `unknown` rather than infer it. Verified live: a Firecrawl scrape of a real homepage (anthropic.com) correctly extracted "AI research and products" as industry and left size/LinkedIn blank rather than inventing them. Gated by `writeAnalysis` (member+); connecting/revoking Firecrawl itself is gated by `manageIntegrations` (admin+), same split as every other integration. Skipped entirely for an ASN-only placeholder company (`as12345`, no real domain to research) |
| ✅ | Graceful degradation | An organization that hasn't connected Firecrawl (or whose connection errors) gets a clean `ResearchUnavailableError`/toast rather than a blocked action |

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

## 17. AI employees — agents that work alongside people

The premise, and the reason this is not an "AI features" panel bolted onto
the side: **an agent is a workspace member that happens to be software.** It
has a name, a job title, a manager-written brief, a role drawn from the same
four-value vocabulary a human member has, and it works the same task board.
Every action it takes passes the same `can.*` check in
`packages/db/src/roles.ts` that a person's click passes, and lands in the
same `audit_log`. There is deliberately no second permission system for
machines — a second interpretation of "may this actor do this" is exactly how
one surface quietly permits what the other forbids.

Work flows both ways. A human assigns a task to an agent by picking it from
the same dropdown they would pick a colleague from. An agent hands work back
by opening a task with a stated `handoffReason` — which is what happens
whenever it hits something it cannot or should not do: a capability its role
denies, a credential nobody has connected, a judgement call about a customer,
or something that happens outside software entirely.

**Skillsets, not agent types.** What makes one agent a growth analyst and
another a support lead is only which *toolkits* it holds. There is no
`agentType` enum the runtime switches on, because that would make "an SDR who
also watches support tickets" inexpressible — and that combination is the
normal shape of a job at a small company. `AGENT_PRESETS` ships seven starting
points (chief of staff, growth analyst, SDR, support lead, content
strategist, revenue ops, growth marketer) — each with a personal name
(Amara, Ingrid, Zoe, Priya, Maya, Leo, Sofia) rather than its job title
repeated, because a roster of colleagues reads differently from a list of
features; after creation an agent is just an agent, and `preset` is
provenance only.

### The autonomy dial, and why it is graded on *effect*

Every tool declares an effect — `read`, `internal` (changes Falorb's own
data, reversible from the same screen), or `external` (reaches another
product, a customer, or anything a person will see). Autonomy is graded
against that, not against tool names or toolkits, because "does this reach
outside the building" is the question a manager is actually answering.

| Autonomy | Reads | Changes inside Falorb | Reaches outside |
|---|---|---|---|
| `observer` | yes | **refused** | **refused** |
| `assisted` (default) | yes | needs approval | needs approval |
| `autonomous` | yes | immediate | needs approval |

"Autonomous" deliberately does not mean unbounded: it makes an agent fast at
its own desk, and a named per-tool grant (`autoApproveTools`) is what lets it
act on someone else's. `["*"]` waives every gate for an operator who wants
that, but it is never a default, never implied, and settable only by an
owner. Independently of all of this, the agent's `role` bounds it from above
— a `viewer` agent set to `autonomous` with a blanket waiver still cannot
write, because the role check runs first and nothing relaxes it.

`autoApproveTools` also accepts `toolkit:<name>` (e.g. `toolkit:crm`),
waiving every tool in one skillset without the all-or-nothing choice between
naming each tool and waiving everything with `"*"`. It sits at the same
admin tier as the rest of agent management (`can.manageAgents`) rather than
owner-only — it is strictly narrower than blanket approval, the same
reasoning that keeps `manageCrm`/`manageUgcVideos` at member tier while only
the credential-holding `manageIntegrations` sits at admin. On the agent
detail page, the per-toolkit "skip approval" checkbox is hidden whenever the
owner-only "act with no approvals at all" checkbox is on, and the client
omits the toolkit selection from that save entirely in that state — sending
an empty selection would otherwise silently clear an owner-set `"*"` out
from under an admin who never saw that setting.

### Approvals do not block the shift

When a gated tool is called, the approval row is written, the agent is told
"this is queued, carry on, do not retry it and do not look for another route"
(stated in its briefing, not left to inference), and it finishes the rest of
its objective. A human decides later and the **worker** performs the action
through the same `tool.execute` the agent would have called — never a second
copy of the logic in the approver's request. Blocking instead would hold a
whole shift hostage to one queued email, and a nightly agent would routinely
resume a day after the numbers it reasoned about stopped being true.

Two checks make the queue a safety feature rather than an escalation route:
approving requires the reviewer to hold the capability the queued tool
declares (`canDecideApproval`) — approving is exercising — and the agent's
role is re-checked at execution time, so an approval sitting in the queue
while somebody demoted the agent does not still fire.

### The loop has to close at both ends

The first build of the queue had an open circuit: nobody was told a request
existed (the only surface was the dashboard page, and undecided requests
expired silently at 72h), and the agent was never told what was decided
(`decisionNote` was documented as "fed back to the agent" and read by
nothing). A gate nobody is told to open, and whose answer never reaches the
thing that asked, is not a human-in-the-loop design — it is a place actions
go to expire. Now:

- **Raising notifies.** `settleApprovals` announces new pending requests:
  one batched email per workspace per sweep to owners and admins
  (`approvalsMail`), plus the same notice to an optional Slack/webhook
  channel (`organizations.approvalNotifyChannelId`, pointing at an
  `alert_channels` row; set on the Settings page). Announced once a
  request's shift has ended, or after ten minutes, so one shift's five
  requests arrive as one message. `agent_approvals.notifiedAt` records it.
  Channel delivery itself moved out of `alerts.ts` into
  `apps/worker/src/channels.ts` so analytics alerts and approval notices
  share one implementation of "reach a person".
- **Deciding feeds back.** The runtime's next briefing for that agent
  carries a "Decisions on your earlier requests" section — approved and
  carried out, rejected with the reviewer's note, expired undecided, or
  failed in execution — and stamps `feedbackDeliveredAt` so it is said
  once. The prompt tells the agent a rejection is a decision, not an
  obstacle.
- **Expiry is not silence.** An approval that expires undecided becomes a
  system-authored task on the board ("Undecided: …", with the agent's own
  rationale) and the run it came from is closed as `needs_attention`
  rather than `succeeded`. `closeSettledRuns` previously marked a run
  succeeded the moment nothing was *pending* — which counted expired and
  failed as settled and filed the shift as a win.
- **Deciding in bulk, and for a while.** `decideApprovalsAction` takes a
  list; every row is re-verified for org, status, expiry and the
  reviewer's capability, and rows that fail are named rather than silently
  dropped. Approving can also carry a grant — "and for a week" — written to
  `agent_approval_grants` (1–30 days, from the queue; anything permanent
  belongs in the agent's `autoApproveTools` where an admin sees it).
  `decide()` consults active grants next to `autoApproveTools`, under the
  same rule: the role check runs first and nothing here relaxes it.
  Grants are listed under "Standing approvals" and can be withdrawn early.

### The kill switch, and why "paused" has to mean paused

`organizations.automationPausedAt` stops every agent in a workspace at once
— from the Settings page, the roster banner, or the MCP server's
`set_automation_paused`. Non-null means: nothing new is enqueued (scheduled,
task-assigned, or alert-triggered), queued runs are not started, a shift in
progress stops at its next turn, and approved actions are not carried out.
Nothing is discarded: paused work stays `queued`/`approved` and resumes
when the switch is cleared, except that an approval whose original 72h
deadline passes during the pause is failed rather than fired — the
human's "yes" was about a moment.

The same stop is enforced twice on purpose. The worker's sweeps join to
`agents.status` and `organizations.automationPausedAt` before claiming
anything, and `executeRun`/`executeApproval` re-check both (`haltReason`)
once they hold the row — so the verify script and MCP, which call the
runtime directly, cannot route around the worker, and a pause landing
between the query and the claim still holds.

This also fixed a real leak in per-agent pause: `runQueuedAgentRuns`
selected on `agent_runs.status` alone with no join to `agents`, and
`executeRun` never read `agent.status`, so a paused agent's queued backlog
— and any approved-but-unexecuted action — kept firing after the person
had pressed "Pause". Both now defer.

| | Feature | Notes |
|---|---|---|
| ✅ | `agents` schema | Name, job title, avatar, brief, `role` (reuses the existing `member_role` enum — welded to the human one on purpose), `autonomy`, `toolkits[]`, `autoApproveTools[]`, `projectIds[]` scope, shift interval + standing objective, and per-agent budget (`maxStepsPerRun`, `dailyRunLimit`, `dailyTokenLimit`). Vocabulary columns are plain `text()`; `role` is the one deliberate exception |
| ✅ | `agent_runs` / `agent_steps` schema | One shift, and its full transcript. **The transcript lives in Postgres, not worker memory** — every model turn and tool result is written as it happens and the next turn's conversation is rebuilt from those rows. Costs a few writes per step; buys a run that survives a worker restart mid-shift, a shift a human can watch progress, and an answer to "what did it actually do" without separate logging |
| ✅ | `tasks` / `task_comments` schema | One table for human work and agent work, because it is the same work. `assigneeType` is stored rather than derived so "assigned to a person, not yet a specific person" is expressible. `handoffReason` gets its own column rather than a line in the body — it is the single most useful thing on a handoff, and it is what tells a manager their agent is under-permissioned rather than incapable |
| ✅ | `agent_approvals` schema | The gate. `requiredCapability` is denormalised from the tool so the reviewer's own role can be checked at decision time. `expiresAt` (72h) because a stale approval is dangerous in a way a stale task is not — "send this follow-up" agreed on Monday should not fire on Friday against numbers nobody re-read. `notifiedAt` / `feedbackDeliveredAt` close the loop at each end (see below); `agent_approval_grants` holds the time-boxed "and for a week" waivers |
| ✅ | `agent_memories` schema | What an agent still knows next week — conclusions and corrections, written by the agent itself through a tool. Without it an agent re-derives the same findings every shift and never accumulates judgement, which is the difference between a scheduled script and an employee. Scoped per agent, not per org: two agents holding contradictory beliefs is legible, whereas a shared pool would let one agent's mistake silently steer another's work |
| ✅ | `auditLog.actorAgentId` | Agent actions land in the same log as human ones. A separate "agent activity" table would mean answering "who changed this deal" required reading two places and merging by timestamp — and the whole point is that both kinds of colleague are accountable the same way |
| ✅ | `@falorb/agents` | The runtime: `policy.ts` (one `decide()` every gate funnels through — UI, worker, and approval-resume all call it, so they cannot drift apart), `run.ts` (the loop, resume, budget, approval raising, `executeApproval`), `prompt.ts` (briefing assembly), `presets.ts`, and the tool registry. Server-only, same boundary `@falorb/ai`/`@falorb/mailer` draw |
| ✅ | Eight toolkits, 30 tools | `analytics` (through `@falorb/queries`, the same layer the dashboard and MCP server read — an agent computing its own aggregates would eventually report a figure a human cannot reproduce), `people`, `leads`, `tasks`, `memory`, `content`, `growth` (referral links and the cached AI signal library), `mcp` (look up and call tools on connected MCP servers — §13). Every toolkit reuses only what `@falorb/queries` already exposes to both the dashboard and the agent runtime, and queries `@falorb/db` directly rather than importing `apps/web/src/server/*` — `@falorb/agents` does not depend on the Next.js app. Regenerating a cached signal is deliberately left out: it is a bespoke, app-layer analytics pipeline per signal kind |
| ✅ | `chat()` in `@falorb/ai` | Tool-calling turn beside the existing `complete()`, separate rather than a flag on it: different shape of interaction, and folding them together would push a `tool_calls` branch into four call sites that will never take it. Both are now thin wrappers over `transport.ts`'s `callModel`, so agents work against either supported gateway. Agents run on `openrouter/auto` like everything else — no pinned model to go stale, no per-deployment model list to maintain. What makes that safe is `provider.require_parameters`, sent whenever tools are present, so auto only considers models that support function calling; without it an agent silently degrades into one that writes prose *about* the action it would have taken |
| ✅ | Shifts bill to the organization's own gateway | Through `@falorb/db`'s shared `resolveAiCredentials`, not a copy — the dashboard, the worker and the agent runtime have to agree on which gateway an org's AI runs against, and two implementations of that eventually disagree. The result is carried on `AgentContext`, resolved once per shift rather than per turn, because it decrypts a stored key and a gateway swapped mid-run would bill half a conversation to each. Without it every shift would quietly fall through to the deployment-wide `OPENROUTER_API_KEY`, ignoring both the connection an org configured and the model it chose. `draft_text` reads the same credentials, so a tool that itself calls a model spends the same key the shift does |
| ✅ | `agents-enqueue` / `agents-run` / `agents-approvals` worker jobs | Enqueue is a cheap indexed lookup on a 1m beat so assigning a task feels immediate; execution costs real model calls, so it runs on its own 2m beat with a small per-sweep cap and `skipOnBoot` (a restart loop must not fire a paid shift on every boot). `nextRunAt` advances at enqueue, not completion, so a wedged run cannot push a daily agent into being a weekly one. Stalled runs are reclaimed by heartbeat and *resume* from `agent_steps` rather than re-running a billed shift |
| ✅ | `/agents`, `/agents/[id]`, `/agents/approvals` | Roster, then brief / permissions / shifts / memory per agent, then the decision queue. Ordered as a manager reviews someone — what they did first, the settings that shaped it second |
| ✅ | `/tasks`, `/tasks/[id]` | The shared board, with one assignee dropdown containing people and agents together. That is the smallest UI decision here and the most load-bearing: choosing who does a piece of work should not begin with choosing what *kind of thing* does it |
| ✅ | Escalation routes closed | `canGrantAgentRole` caps an agent's role at the granter's own (otherwise an admin creates an `owner` agent and drives it); `canDecideApproval` requires the reviewer to hold the tool's capability; blanket auto-approval is owner-only. 12 unit tests in `policy.test.ts` cover each |
| ✅ | Resume tested without a database | `rebuildMessages` is pure and exported precisely so the post-crash path can be asserted (`run.test.ts`) — see §19a |
| ✅ | Agent-to-agent delegation | `delegate_task` (tasks toolkit) assigns work directly to another agent, the same `manageTasks`/`internal` grade as `create_task`. `tasks.delegationDepth` bounds it — `MAX_DELEGATION_DEPTH = 3` in `packages/agents/src/tools/tasks.ts`, checked by the pure, unit-tested `checkDelegation` — rather than cycle detection: the counter is monotonically increasing, so it caps any loop shape (chain or ping-pong) regardless. Self-delegation is refused outright. The worker (`enqueueAgentTasks`) tells a human-assigned task from a delegated one by `creatorType`, writing `trigger: "delegation"` only for the latter |
| ✅ | Event-triggered shifts | `alertChannels.kind` gained `"agent"` (`config: { agentId, objective? }`); when a rule fires, `apps/worker/src/jobs/alerts.ts`'s `deliver()` queues a normal `agent_runs` row (`trigger: "alert"`) instead of sending a message anywhere. Nothing about being alert-triggered bypasses policy — same role/autonomy gates, same approval queue for anything external. The looked-up agent's `organizationId` is checked against the rule's explicitly, since `config` is loosely-typed JSON on an admin-authored row rather than a foreign key |
| ✅ | Task editing and deletion | `updateTaskAction` / `deleteTaskAction`, plus an edit card on the task page. Status and assignee are deliberately excluded from that form — both are one-click controls elsewhere on the same page, and duplicating them into a Save-button form would give one thing two ways to change that disagree about whether the change has landed |
| ✅ | Verified against a live model | `pnpm --filter @falorb/agents verify` drives a real shift end to end. Confirmed working: the loop (43 steps, 8 turns, $0.005), tool dispatch through the real query layer, transcript persistence, the budget backstop, **the approval gate holding** under `assisted` (a `create_task` was queued, not performed), the approve → worker-execute round trip actually creating the task, and agent attribution in `audit_log`. See §19a for what that run exposed and what is still unproven |

### 17a. What the live run exposed, and what is still unproven

The first real shift worked and found three genuine defects, all since fixed:

1. **Markdown in the report.** The briefing asks for plain prose; the model
   opened with `## Report` and used `**bold**` regardless. The summary is
   rendered without a markdown parser, so that showed as literal hashes on
   screen. Now passed through `@falorb/ai`'s `stripMarkdown` — whose own
   docblock already says an instruction alone is not reliable here. It was
   right.
2. **A tool call written out as text.** When the turn budget runs out the
   loop asks for a closing report with the tools withheld — but did not
   *say* they were withheld, so the model emitted its intended
   `create_task` call as literal markup inside the report. The closing
   instruction now names the constraint and gives the intent somewhere else
   to go ("say so and leave it as a recommendation").
3. **"Steps" meaning two different things.** The budget counts model turns;
   `stepCount` counts transcript rows, which is several times larger. Both
   were labelled "steps" in the same UI, so a limit of 8 sat next to a run
   reporting 61. The budget control now says "turns".

A fourth was found by review rather than by running, and is the one that
would have hurt most: **resumed runs could not have worked.** `rebuildMessages`
synthesised tool-call ids on the assistant side while reusing the original
ids on the result side, so no `tool` message would have matched a preceding
assistant `tool_calls[].id` and the first request of every resumed run would
have been rejected outright — the failure landing precisely on the
post-crash path the persisted transcript exists to protect. Real ids are now
persisted, and the rebuild is a pure exported function with six tests
(`run.test.ts`) asserting the pairing invariant directly, since a path that
only runs after a worker dies is one normal use never exercises.

Still unproven, honestly:

- **The closing-report fix (2) has not been re-run** — the OpenRouter account
  ran out of credit partway through verification. The credit-exhaustion path
  itself is confirmed to behave correctly (run marked failed with the
  provider's message, transcript intact, already-queued approval preserved),
  but the corrected prompt has not been seen working.
- **The approval loop and kill switch have been exercised by the worker's
  real sweeps, against a live database, but not with a live model.** A
  scripted smoke drove `runQueuedAgentRuns`/`settleApprovals` end to end:
  a paused workspace and a paused agent both left a queued run queued and
  an approved action un-executed; resuming executed it; a fresh pending
  approval got `notifiedAt` (log mail transport); an overdue one expired,
  produced its "Undecided:" task, and flipped its run to `needs_attention`;
  and `loadDecisionFeedback` returned all three outcomes with the reviewer's
  note present in the built briefing. The mid-shift halt (the per-turn
  `haltReason` check inside the loop) typechecks and follows the same
  path, but has not been seen stopping a real model loop.
- **No agent has been driven by the worker's own sweeps.** `executeRun` and
  `executeApproval` were called directly by the verify script. The scheduling,
  claiming and heartbeat-reclaim logic in `apps/worker/src/jobs/agents.ts`
  typechecks and follows the same locking pattern as the other jobs, but has
  not run in a live worker process.

---

## Backend surface not yet in the dashboard

Audited by enumerating every schema table and every query-layer export, then
checking what `apps/web` actually references. The dashboard is **not** a
complete front end for the backend; these are the gaps, in the order they cost
the most.

| Backend | State | What is missing in the UI |
|---|---|---|
| `dashboardWidgets` | table | The design system's custom-view builder (widget grid) is not built; `/insights` is a single fixed layout |

`dataRequests`, `webhooks`, `consentRecords`, `auditLog` and `personMerges` are
now built — see §18. `closedSessions` was removed from this list: it's a
worker-internal ingestion query (`sessionizer.ts`/`backfill.ts` roll closed
sessions into Postgres totals against raw `events`) with different
correctness requirements than the UI's own `sessionList` (which reads
`events_v` live, so identity merges are reflected) — not a missing frontend
feature, just a different consumer.

`segments` is now built: a two-level condition-tree builder
(`@/components/ConditionTreeBuilder` — AND across groups, OR within a group,
producing the exact `Filter[]` `compileFilters`/`refreshSegmentCounts` already
expect), a `/segments` management page (list/rename/delete, showing
`cachedCount`/`cachedAt`), and a "Save as segment" entry point on the People
page that scopes the saved segment to that property. Verified end to end: a
saved segment's definition round-tripped through `refreshSegmentCounts`
(`apps/worker/src/jobs/rollups.ts`) via `verify-jobs.ts` and its `cachedCount`
updated in the UI.

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
3. Saved funnels, saved insights and segments (condition-tree builder,
   `/segments`, "Save as segment" on the People page) are now built.
4. The custom-view widget builder — depends on saved insights existing first.
5. Coolify deploy, then instrument the primary site first.
