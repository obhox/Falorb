# Deploying Falorb to Coolify

Target: `falorb.com` on the existing Coolify server (`YOUR_SERVER_IP`).

**Coolify does not build anything.** GitHub Actions builds every image and
pushes it to GHCR; Coolify pulls. The production compose file has no `build:`
sections, so a deploy is a `docker compose pull` and a restart — roughly a
minute, not the five to ten a from-source build took. It also means the
container serving traffic is bit-for-bit the one CI tested, and that a
rollback is a tag change rather than a rebuild.

What remains genuinely needs your Coolify console and your DNS registrar.

---

## 1. DNS

Add four `A` records at your registrar, all pointing at the server:

| Type | Name  | Value           | Purpose |
|------|-------|-----------------|---------|
| A    | `a`   | `YOUR_SERVER_IP`  | Collector — the tracker endpoint |
| A    | `dashboard` | `YOUR_SERVER_IP`  | Dashboard |
| A    | `referral` | `YOUR_SERVER_IP`  | Referral links (`/r/<code>`) |
| A    | `api` | `YOUR_SERVER_IP`  | Account & management API |
| A    | `mcp` | `YOUR_SERVER_IP`  | MCP server for AI assistants |

Five subdomains rather than paths on one, deliberately:

- **`a.` is separate so an ad-blocker rule cannot take the dashboard down.**
  Blocklists target collector hostnames; if the dashboard shared that
  hostname it would be blocked alongside it.
- `api.` and `dashboard.` are separate hosts but share the parent domain, so
  the session cookie stays first-party.
- **`referral.` is separate so a link someone actually shares doesn't read
  as the internal dashboard's own address.** It's the same `web` container
  and the same `/r/[code]` route as the dashboard — just its own hostname.
  In Coolify, add `referral.falorb.com` as an *additional* domain on the
  `web` service (Domains field in the console): the compose file's
  `SERVICE_FQDN_WEB_3000` only wires the primary one automatically.

Wait for propagation before deploying — Coolify requests certificates on
first boot, and Let's Encrypt failing leaves you retrying behind a rate limit.

```bash
dig +short a.falorb.com dashboard.falorb.com referral.falorb.com api.falorb.com mcp.falorb.com
```

---

## 2. Images

Seven images, all built by `.github/workflows/ci.yml` and published to GHCR:

| Image | Built from | Service |
|---|---|---|
| `ghcr.io/obhox/falorb-ingest` | `Dockerfile.ingest` | `ingest` |
| `ghcr.io/obhox/falorb-clickhouse` | `Dockerfile.clickhouse` | `clickhouse` |
| `ghcr.io/obhox/falorb-web` | `Dockerfile.web` | `web` |
| `ghcr.io/obhox/falorb-db` | `Dockerfile.node` (`APP=db`) | `migrate` |
| `ghcr.io/obhox/falorb-api` | `Dockerfile.node` (`APP=api`) | `api` |
| `ghcr.io/obhox/falorb-worker` | `Dockerfile.node` (`APP=worker`) | `worker` |
| `ghcr.io/obhox/falorb-mcp` | `Dockerfile.node` (`APP=mcp`) | `mcp` |

Each is tagged `latest` and with the full commit SHA. The publish job `needs`
both test jobs, so a red suite cannot produce a `latest` — the worst case is
that `latest` is one commit stale, never that it is broken.

**Make the packages public** the first time each one is published:
GitHub → your profile → **Packages** → *package* → **Package settings** →
**Change visibility → Public**. Otherwise every pull needs credentials.

If you would rather keep them private, add a registry credential in Coolify
(**Servers → *your server* → **Docker Registries**) using a GitHub personal
access token with `read:packages`. Nothing in the compose file changes.

---

## 3. Create the Coolify resource

1. **Projects → + New → Project**, name it `falorb`.
2. Inside it: **+ New Resource → Docker Compose**.
3. Source: **GitHub**, repository `<your-github-org>/falorb`, branch `main`.

   Coolify still reads the repository, because the compose file lives there
   and the `SERVICE_FQDN_*` magic variables are resolved from it. It no
   longer builds from it.
4. **Compose file path**: `infra/docker-compose.production.yml`

   Not `infra/docker-compose.yml`. That one is for local development and
   publishes Postgres, Redis and ClickHouse on host ports with the password
   `falorb`. Deploying it would put three unauthenticated databases on the
   public internet.
5. **Base directory**: `/` — the compose file path above is relative to it.

---

## 4. Environment variables

Coolify generates anything named `SERVICE_PASSWORD_*` or `SERVICE_BASE64_*`
itself, and persists it across redeploys. You only set these:

| Variable | Value |
|---|---|
| `FALORB_DOMAIN` | `falorb.com` |
| `RESEND_API_KEY` | your Resend key |
| `EMAIL_FROM` | `Falorb <noreply@falorb.com>` |
| `IPINFO_TOKEN` | *(optional)* enables B2B company identification |
| `FALORB_RATE_LIMIT` | *(optional)* default `600` events/min per IP hash |
| `FALORB_IMAGE_TAG` | *(optional)* default `latest`; a commit SHA pins the deploy |
| `FALORB_IMAGE_PREFIX` | *(optional)* default `ghcr.io/obhox/falorb`; only for forks |

Then set each service's domain. For a Docker Compose resource these are
**environment variables**, not the Domains field — Coolify pre-creates one
`SERVICE_FQDN_<SERVICE>` per service that declares `SERVICE_FQDN_<SERVICE>_<PORT>`
in the compose file, and you edit its value:

| Variable | Value |
|---|---|
| `SERVICE_FQDN_INGEST` | `https://a.falorb.com` |
| `SERVICE_FQDN_API` | `https://api.falorb.com` |
| `SERVICE_FQDN_MCP` | `https://mcp.falorb.com` |
| `SERVICE_FQDN_WEB` | `https://dashboard.falorb.com` |

They are generated pointing at a `sslip.io` hostname, so leaving one unset does
not fail loudly — that service is simply not on the domain you expected.

`referral.falorb.com` has no `SERVICE_FQDN_*` of its own — a compose service
gets exactly one from Coolify. Add it as a second domain on the **same** `web`
service instead, via the Domains field in the Coolify console (the one place
in this doc that field is actually used). `FALORB_REFERRAL_URL` in the compose
file already points at it; without this step referral links silently fall
back to `FALORB_APP_URL` and read as `dashboard.falorb.com` links instead.

`worker` gets **no domain** — it serves no HTTP and must not be reachable.

### About `EMAIL_FROM`

Must be on a domain verified in Resend. Until `falorb.com` is verified there,
email silently fails to send: password reset and invites will log instead of
delivering, and email verification stays disabled so nobody is locked out.
Verify the domain in Resend before relying on it.

---

## 5. Deploy

Hit **Deploy**. It pulls seven images and starts them — around a minute,
and no compilation on the server.

Order is enforced by the compose file: databases become healthy, `migrate`
runs to completion, then the apps start. If `migrate` fails, the apps do not
start against a missing schema — that is intentional, so check its logs first
when a deploy stalls.

### Deploying automatically on every green build

Optional, and the reason CI has a `deploy` job. Set two GitHub repository
secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `COOLIFY_WEBHOOK_URL` | the resource's **Webhooks → Deploy** URL |
| `COOLIFY_TOKEN` | a Coolify API token with deploy permission |

With both set, a merge to `main` builds the images and then tells Coolify to
pull them. With neither, CI still publishes and you press **Deploy** yourself;
the job reports that it had nothing to call and passes. It is written that way
so a fork's build does not fail on secrets it cannot have.

---

## 6. Verify

```bash
curl -sI https://dashboard.falorb.com/ | head -1
# 307 — the dashboard redirecting an unauthenticated request to sign-in

curl https://a.falorb.com/health
# {"ok":true,"redis":true,"geo":false,"tracker":true}

curl -sI https://a.falorb.com/t.js | head -3
# 200, ~6.5 KB, immutable cache

curl https://api.falorb.com/health
# {"ok":true}

curl https://mcp.falorb.com/health
# {"ok":true,"server":"falorb-analytics","version":"0.1.0"}

curl -sI https://dashboard.falorb.com/sign-in | head -1
# 200 — and the response carries X-Frame-Options, HSTS and the rest,
# which is how you know it is the app answering and not the proxy.
```

`"geo":false` is expected until step 8.

---

## 7. Create your account

The first account to sign up gets its own workspace — there is no seeded
admin.

```bash
curl -X POST https://api.falorb.com/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@falorb.com","password":"<a real password>","name":"Your Name"}'
```

Then create a project and get its snippet:

```bash
curl -X POST https://api.falorb.com/api/projects \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"name":"Acme","domains":["acme.example"]}'
```

---

## 8. GeoIP (optional)

**Country usually works without this.** If a CDN fronts the collector —
Cloudflare, Vercel or Fastly all qualify — the edge resolves the country before
the request arrives and the collector reads it from the header. No database, no
licence key, no lookup cost.

MaxMind adds **region, city and ASN**, which no header carries. Set it up if you
want those; skip it if country is enough.

`GET /health` reports which is in use:

```
{"geo": true, "geoSource": "database"}   MaxMind loaded
{"geo": true, "geoSource": "header"}     edge header only — country, no city
{"geo": false, "geoSource": "none"}      no geo at all
```

Set one variable and redeploy:

```
MAXMIND_LICENSE_KEY=...      # free key at https://www.maxmind.com/en/geolite2/signup
```

The `ingest` entrypoint downloads the database into the `falorb-geoip` volume
before the collector starts, and refreshes it once it is older than
`GEOIP_MAX_AGE_DAYS` (default 30). The volume is named, so a redeploy reuses
the existing copy rather than re-fetching 70MB from MaxMind.

Nothing else is required — no persistent volume to add by hand, no `docker
exec`. `MAXMIND_DB_PATH` defaults to the right path inside the volume.

**Why it is not in the image.** The City database is ~70MB, MaxMind's licence
forbids redistribution, and it is stale within weeks. It belongs in a volume,
fetched at run time.

**Failure is never fatal.** If the key is missing, MaxMind is unreachable, or
the download times out, the collector starts anyway and geo fields stay empty.
Losing pageviews because a licence key expired would be a far worse outcome
than losing country. Check the startup logs for `[geoip]` lines to see which
path was taken.

**It only applies going forward.** The raw IP is discarded at ingest by design,
so events already collected cannot be re-resolved — they keep their empty
country permanently.

**Refresh needs a restart.** The database is opened once at boot and held in
memory, so a refreshed file is picked up on the next container start rather
than immediately.

---

## 9. Instrument the sites

```html
<script defer src="https://a.falorb.com/t.js" data-project="prj_..."></script>
```

Wire `identify()` into each product's login. **This is the only thing that
unifies a person across products** — without it, someone using Beacon and
Notewell is two unrelated visitors:

```js
falorb.identify(user.id, { email: user.email, plan: user.plan })
```

To link anonymous click-throughs between your own domains, add:

```html
<script defer src="https://a.falorb.com/t.js"
        data-project="prj_..."
        data-cross-domain="beacon.example,notewell.example,ledgerly.example"></script>
```

---

## 10. Backups

`infra/backup.sh` handles both stores. Add it as a Coolify **Scheduled Task**:

```
Command:  ./infra/backup.sh
Schedule: 0 3 * * *
```

Postgres is the one that matters — it holds accounts, project keys and the
identity graph, none of which can be reconstructed. ClickHouse loss costs
history only.

ClickHouse incremental backups need a `backups` disk configured under
`<storage_configuration>`; without it that half of the script fails loudly
and the Postgres dump still runs.

---

## Notes

**Redeploys are safe.** Migrations are idempotent, and Coolify keeps the
generated passwords, so the volumes stay readable.

**Rolling back** is setting `FALORB_IMAGE_TAG` to an older commit SHA and
redeploying. The image already exists, so it takes as long as a pull. Schema
migrations do not roll back with it — the ClickHouse ones are additive, but a
Postgres migration would need reverting by hand, and rolling the code back
past one leaves the app running against a newer schema.

**A hotfix still goes through CI.** There is no path that builds on the
server any more, and that is the point — pushing a branch and merging is the
only way to produce an image. To rebuild the current commit without changing
it (a patched base image, say), run the CI workflow manually:
**Actions → CI → Run workflow**.

---

## Notes on Coolify's behaviour

Three things it does that a plain `docker compose up` does not. Each cost a
failed deploy here, and each is already handled in the compose file and
Dockerfiles — this is why those files look the way they do. The third is the
reason nothing is built on the server any more.

**Relative bind mounts are not honoured.** Coolify rewrites them into
directories it manages under `/data/coolify/applications/<uuid>/` and creates
them *empty*; the repository's files are never copied in. ClickHouse's config
arrived that way, and mounting an empty directory over
`/etc/clickhouse-server/config.d` also masks the image's own
`docker_related_config.xml` — the setting that makes it listen on `0.0.0.0`. The
server fell back to loopback, so `clickhouse-client` inside the container kept
answering while every other container got `ECONNREFUSED` on port 8123. The
compose healthcheck passed throughout, because it used the native protocol
rather than the HTTP interface every caller actually uses. The config is now
baked into `Dockerfile.clickhouse`, and the healthcheck tests HTTP.

**A service with no `EXPOSE` gets no route.** `Dockerfile.node` is shared by
services listening on different ports, so it declares none, and the proxy
answered "no available server" for containers that were running perfectly. Each
service that takes traffic therefore declares `expose:` in the compose file.

**Builds ran with `--no-cache`.** Every deploy reinstalled the whole workspace
once per image, in parallel. On a small shared server that was the difference
between a five-minute deploy and a thirty-minute one, and npm metadata requests
were measured at 80s each under the contention. This is what moved the builds
to CI: the compose file no longer has a `build:` section for Coolify to act on,
so the behaviour is now unreachable rather than merely worked around.
