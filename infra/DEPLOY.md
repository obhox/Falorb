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
| A    | `api` | `YOUR_SERVER_IP`  | Account & management API |
| A    | `mcp` | `YOUR_SERVER_IP`  | MCP server for AI assistants |

Four subdomains rather than paths on one, deliberately:

- **`a.` is separate so an ad-blocker rule cannot take the dashboard down.**
  Blocklists target collector hostnames; if the dashboard shared that
  hostname it would be blocked alongside it.
- `api.` and `dashboard.` are separate hosts but share the parent domain, so
  the session cookie stays first-party.

Wait for propagation before deploying — Coolify requests certificates on
first boot, and Let's Encrypt failing leaves you retrying behind a rate limit.

```bash
dig +short a.falorb.com dashboard.falorb.com api.falorb.com mcp.falorb.com
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

Then set each service's domain under **Configuration → Domains**:

| Service | Domain |
|---|---|
| `ingest` | `https://a.falorb.com` |
| `web` | `https://dashboard.falorb.com` |
| `api` | `https://api.falorb.com` |
| `mcp` | `https://mcp.falorb.com` |

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

Country, region and city stay empty without it. Collection is unaffected.

1. Free key at <https://www.maxmind.com/en/geolite2/signup>
2. Add a Coolify **persistent volume** on `ingest`, mounted at `/geoip`
3. Set `MAXMIND_DB_PATH=/geoip/GeoLite2-City.mmdb`
4. Download into the volume:

```bash
docker exec -it <ingest-container> sh
MAXMIND_LICENSE_KEY=... MAXMIND_DB_DIR=/geoip node scripts/download-geoip.mjs
```

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
