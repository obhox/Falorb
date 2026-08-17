import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { wireBatchSchema } from "@falorb/core";
import { EVENT_STREAM, loadConfig } from "./config";
import { decodeBatch } from "./decode";
import { clientIp, geoSources, initGeo, resolveGeo } from "./geo";
import { hashIp } from "./identity";
import { createDatabase, schema } from "@falorb/db";
import { ProjectCache, originAllowed, type CachedProject } from "./projects";
import { evaluateConsent, shouldRecordConsent } from "./consent";
import { EventStream } from "./stream";

const config = loadConfig();
const projects = new ProjectCache(config.databaseUrl);

/**
 * Separate connection for the consent log.
 *
 * Consent writes are rare and fire-and-forget; keeping them off the project
 * cache's connection means a slow write can never block a project lookup,
 * which every single request depends on.
 */
const consentLog = createDatabase(config.databaseUrl);
const stream = new EventStream(config.redisUrl);
const geoReady = await initGeo(config.maxmindPath);

let trackerBundle: string | null = null;
try {
  trackerBundle = readFileSync(config.trackerPath, "utf8");
} catch {
  console.warn(`[tracker] bundle not found at ${config.trackerPath} — run \`pnpm build\``);
}

const app = new Hono();

// The collector is called cross-origin from every tracked site by definition,
// so it must accept any origin. Per-project authorisation is enforced against
// the project's configured domains inside the handler, which is the check that
// actually matters. Credentials are never accepted.
app.use(
  "/e",
  cors({
    origin: (o) => o ?? "*",
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: false,
    maxAge: 86400,
  }),
);

app.get("/health", async (c) => {
  const redisOk = await stream.ping();
  const sources = geoSources(c.req.raw.headers);

  return c.json(
    {
      ok: redisOk,
      redis: redisOk,
      // True when country can be resolved by *either* route, so this answers
      // the question the dashboard actually asks: will events carry a country?
      // `geoSource` says which, because "database" and "header" fail for
      // different reasons and are fixed differently.
      geo: sources.database || sources.header,
      geoSource: sources.database ? "database" : sources.header ? "header" : "none",
      tracker: trackerBundle !== null,
    },
    redisOk ? 200 : 503,
  );
});

/**
 * Serve the tracker.
 *
 * Immutable + one year: the filename is versioned by deploy, and a browser
 * re-fetching this on every pageview would defeat the point of keeping it
 * small. Old cached copies stay valid because the wire format only ever gains
 * optional fields.
 */
app.get("/t.js", (c) => {
  if (!trackerBundle) return c.text("// falorb: tracker bundle unavailable", 503);
  return c.body(trackerBundle, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Access-Control-Allow-Origin": "*",
  });
});

app.post("/e", async (c) => {
  // Parsed manually: the tracker sends Content-Type text/plain so the request
  // stays a CORS "simple request" and skips the preflight round-trip entirely.
  let payload: unknown;
  try {
    payload = JSON.parse(await c.req.text());
  } catch {
    return c.body(null, 400);
  }

  const parsed = wireBatchSchema.safeParse(payload);
  if (!parsed.success) return c.body(null, 422);
  const batch = parsed.data;

  const project = await projects.get(batch.k);
  if (!project || project.archived) {
    projects.markMissing(batch.k);
    return c.body(null, 404);
  }
  if (!originAllowed(project, c.req.header("origin") ?? null)) return c.body(null, 403);

  // Consent is enforced here, before any enrichment or storage. Under opt-in a
  // batch without explicit consent is discarded outright — 204 rather than an
  // error, because a refusal is a normal outcome the tracker should not retry
  // or surface on the visitor's page.
  const consent = evaluateConsent(project, batch);
  if (!consent.accept) {
    recordConsent(project, batch, false);
    return c.body(null, 204);
  }
  recordConsent(project, batch, consent.consentGranted);

  const ip = clientIp(c.req.raw.headers);
  const receivedAt = Date.now();

  // Rate limit on the same daily hash that is stored, so the limiter never
  // needs the raw address either. An unattributable request (no usable client
  // address) is refused rather than exempted — see `EventStream.allow`.
  const rlKey = ip ? hashIp(ip, project.id, config.saltSecret, new Date(receivedAt)) : "";
  if (!(await stream.allow(rlKey, config.rateLimitPerIp))) return c.body(null, 429);

  // A per-IP limit does nothing against a flood spread across many addresses,
  // and the public key that authorises this write is in the customer's page
  // source. The project ceiling bounds that.
  if (!(await stream.allowProject(project.id, config.rateLimitPerProject))) {
    return c.body(null, 429);
  }

  const events = decodeBatch(batch, {
    project,
    userAgent: c.req.header("user-agent") ?? "",
    ip,
    // Database first, edge header as the fallback — see resolveGeo.
    geo: resolveGeo(ip, c.req.raw.headers),
    saltSecret: config.saltSecret,
    receivedAt,
  });

  try {
    await stream.publish(events);
  } catch (error) {
    // Redis is down. Report it, but do not make the visitor's browser retry —
    // a failing analytics endpoint must never become visible on the site.
    console.error("[ingest] publish failed:", String(error));
    return c.body(null, 202);
  }

  return c.body(null, 204);
});

console.log(
  `[ingest] listening on :${config.port}  stream=${EVENT_STREAM}  geo=${geoReady ? "database" : geoSources().header ? "header-fallback" : "off"}`,
);

export default { port: config.port, fetch: app.fetch };

/**
 * Persist an explicit consent decision.
 *
 * Fire-and-forget on purpose: the lawful-basis paper trail must never add
 * latency to, or be able to fail, the collection request itself. Duplicate
 * decisions from the same device are expected and harmless — the table is an
 * append-only log, and when a decision was made matters as much as what it was.
 */
function recordConsent(
  project: CachedProject,
  batch: { d: string; c?: 0 | 1 },
  granted: boolean | null,
): void {
  if (!shouldRecordConsent(project, granted)) return;
  void consentLog
    .insert(schema.consentRecords)
    .values({
      projectId: project.id,
      distinctId: batch.d,
      granted: granted ? 1 : 0,
      policyVersion: null,
    })
    .catch((error) => console.error("[consent] record failed:", String(error)));
}
