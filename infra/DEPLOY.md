# Deploying Falorb to Coolify

Target: `falorb.com` on the existing Coolify server (`YOUR_SERVER_IP`).

Everything here has been built and run locally — the four images build, the
migration container applies both schemas against empty databases, and the
collector serves the tracker. What remains genuinely needs your Coolify
console and your DNS registrar.

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

## 2. Create the Coolify resource

1. **Projects → + New → Project**, name it `falorb`.
2. Inside it: **+ New Resource → Docker Compose**.
3. Source: **GitHub**, repository `<your-github-org>/falorb`, branch `main`.
4. **Compose file path**: `infra/docker-compose.production.yml`

   Not `infra/docker-compose.yml`. That one is for local development and
   publishes Postgres, Redis and ClickHouse on host ports with the password
   `falorb`. Deploying it would put three unauthenticated databases on the
   public internet.
5. **Base directory**: `/` (the build context is the repository root — the
   Dockerfiles need the workspace manifests).

---

## 3. Environment variables

Coolify generates anything named `SERVICE_PASSWORD_*` or `SERVICE_BASE64_*`
itself, and persists it across redeploys. You only set these:

| Variable | Value |
|---|---|
| `FALORB_DOMAIN` | `falorb.com` |
| `RESEND_API_KEY` | your Resend key |
| `EMAIL_FROM` | `Falorb <noreply@falorb.com>` |
| `IPINFO_TOKEN` | *(optional)* enables B2B company identification |
| `FALORB_RATE_LIMIT` | *(optional)* default `600` events/min per IP hash |

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

`worker` gets **no domain** — it serves no HTTP and must not be reachable.

### About `EMAIL_FROM`

Must be on a domain verified in Resend. Until `falorb.com` is verified there,
email silently fails to send: password reset and invites will log instead of
delivering, and email verification stays disabled so nobody is locked out.
Verify the domain in Resend before relying on it.

---

## 4. Deploy

Hit **Deploy**. First build takes roughly 5–10 minutes — four images, and pnpm
installs the whole workspace once per Dockerfile.

Order is enforced by the compose file: databases become healthy, `migrate`
runs to completion, then the apps start. If `migrate` fails, the apps do not
start against a missing schema — that is intentional, so check its logs first
when a deploy stalls.

---

## 5. Verify

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
```

`"geo":false` is expected until step 7.

---

## 6. Create your account

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

## 7. GeoIP (optional)

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

## 8. Instrument the sites

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

## 9. Backups

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

**The dashboard is not in this compose file.** `apps/web` has no Dockerfile
yet — it is being built in a separate session. Add a `web` service pointing at
`dashboard.falorb.com` once it does.

**Redeploys are safe.** Migrations are idempotent, and Coolify keeps the
generated passwords, so the volumes stay readable.

**Rolling back** means redeploying an older commit. Schema migrations do not
roll back automatically — the ClickHouse ones are additive, but a Postgres
migration would need reverting by hand.

---

## Notes on Coolify's behaviour

Three things it does that a plain `docker compose up` does not. Each cost a
failed deploy here, and each is already handled in the compose file and
Dockerfiles — this is why those files look the way they do.

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

**Builds run with `--no-cache`.** Every deploy reinstalls the whole workspace
once per image, in parallel. On a small shared server that is the difference
between a five-minute deploy and a thirty-minute one, and npm metadata requests
were measured at 80s each under the contention. If deploys are slow, build the
images in CI and have Coolify pull them rather than building on the box.
