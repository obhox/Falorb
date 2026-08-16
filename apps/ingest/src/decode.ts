import { randomUUID } from "node:crypto";
import {
  AUTO_EVENTS,
  MAX_CLOCK_SKEW_MS,
  classifyReferrer,
  parseUrl,
  parseUtm,
  parseUserAgent,
  splitProps,
  type FalorbEvent,
  type WireBatch,
  type WireEvent,
  maskPath,
  maskProps,
  maskUrl,
  resolveMaskingRules,
  scrubText,
} from "@falorb/core";
import type { CachedProject } from "./projects";
import { decodeCrossDomainToken, derivePersonId, deriveSessionId, hashIp } from "./identity";
import type { GeoResult } from "./geo";

export interface DecodeContext {
  project: CachedProject;
  userAgent: string;
  ip: string;
  geo: GeoResult;
  saltSecret: string;
  receivedAt: number;
}

/**
 * Turn one wire batch into canonical events.
 *
 * Pure and synchronous by design — no I/O anywhere in here, so the whole
 * transformation costs microseconds and can be unit tested without a database,
 * a network, or a running server.
 */
export function decodeBatch(batch: WireBatch, ctx: DecodeContext): FalorbEvent[] {
  const { project, receivedAt } = ctx;
  const ua = parseUserAgent(ctx.userAgent);

  // distinct_id is always the *device*, never the identified user id. Keeping
  // it device-scoped means person resolution has exactly one input, and a user
  // logging in on a second device produces a second person that the resolver
  // then merges — rather than two partial identities that never reconcile.
  const distinctId = batch.d;
  const personId = derivePersonId(project.id, distinctId);
  const sessionId = deriveSessionId(project.id, batch.s);
  const ipHash = ctx.ip ? hashIp(ctx.ip, project.id, ctx.saltSecret, new Date(receivedAt)) : "";

  return batch.e.map((raw) => decodeEvent(raw, batch, ctx, { ua, distinctId, personId, sessionId, ipHash }));
}

interface BatchDerived {
  ua: ReturnType<typeof parseUserAgent>;
  distinctId: string;
  personId: string;
  sessionId: string;
  ipHash: string;
}

function decodeEvent(
  raw: WireEvent,
  batch: WireBatch,
  ctx: DecodeContext,
  d: BatchDerived,
): FalorbEvent {
  const { project, geo, receivedAt } = ctx;
  // Masking is applied before anything is parsed out of the URL, so a
  // sensitive query parameter never reaches the stored `url`, the derived
  // `path`, or any downstream rollup.
  const masking = resolveMaskingRules(project.settings);
  const page = parseUrl(maskUrl(raw.u ?? "", masking));
  const utm = parseUtm(raw.u);
  const classified = classifyReferrer({
    referrer: raw.r,
    utm,
    selfHost: page.host,
    ownHosts: project.domains,
  });

  // Masked once, then used for every derived form. `propsRaw` must come from
  // the masked bag too — it is the verbatim payload shown in the event detail
  // view, and populating it from `raw.p` would preserve exactly the values
  // masking just removed.
  const maskedProps = maskProps(raw.p, masking);
  const { propsStr, propsNum } = splitProps(maskedProps);

  // `$identify` carries the site-supplied user id so the identity-resolver can
  // find it without re-reading the batch envelope.
  if (raw.n === AUTO_EVENTS.identify && batch.i) {
    propsStr.identified_id = batch.i;
  }
  // A cross-domain link token is decoded and validated *here*, not stored raw
  // for a worker to interpret later. Its whole security property is a two
  // minute freshness window, and by the time a batched sweep sees it that
  // window is meaningless — a token that leaked into a shared URL or a
  // crawler's index would still merge two unrelated people. Validating at the
  // point of arrival is the only place the timing check is worth anything.
  //
  // Only the resolved source device survives, so nothing downstream can
  // re-interpret an expired token.
  if (batch.xl) {
    const link = decodeCrossDomainToken(batch.xl, receivedAt);
    if (link && link.deviceId !== batch.d) {
      propsStr.xdomain_from = link.deviceId;
    }
  }

  return {
    projectId: project.id,
    eventId: randomUUID(),
    timestamp: clampTimestamp(raw.t, receivedAt),
    name: raw.n.slice(0, 128),

    distinctId: d.distinctId,
    personId: d.personId,
    sessionId: d.sessionId,

    url: page.url,
    path: maskPath(page.path, masking),
    host: page.host,
    // Page titles routinely embed order numbers and customer names, and a
    // referrer carries the full query string of the page someone came from.
    title: scrubText((raw.ti ?? "").slice(0, 512), masking),
    referrer: raw.r ? maskUrl(raw.r, masking) : "",
    referrerHost: classified.referrerHost,

    utmSource: utm.source,
    utmMedium: utm.medium,
    utmCampaign: utm.campaign,
    utmTerm: utm.term,
    utmContent: utm.content,
    channel: classified.channel,
    source: classified.source,

    browser: d.ua.browser,
    browserVersion: d.ua.browserVersion,
    os: d.ua.os,
    osVersion: d.ua.osVersion,
    deviceType: d.ua.deviceType,
    screenW: clampU16(batch.sw),
    screenH: clampU16(batch.sh),
    viewportW: clampU16(batch.vw),
    viewportH: clampU16(batch.vh),

    country: geo.country,
    region: geo.region,
    city: geo.city,
    timezone: (batch.tz ?? "").slice(0, 64),
    language: (batch.l ?? "").slice(0, 35),
    asn: geo.asn,
    asnOrg: geo.asnOrg,

    companyDomain: "",

    propsStr,
    propsNum,
    propsRaw: maskedProps ? JSON.stringify(maskedProps) : "",

    revenue: typeof raw.rv === "number" && Number.isFinite(raw.rv) ? raw.rv : null,
    currency: (raw.cu ?? "").toUpperCase().slice(0, 3),
    durationMs: Math.min(raw.du ?? 0, 86_400_000),

    isBot: d.ua.isBot,
    botName: d.ua.botName,
    ipHash: d.ipHash,
    trackerVersion: (batch.v ?? "").slice(0, 16),
  };
}

/**
 * Clamp a client-supplied timestamp to something plausible.
 *
 * Device clocks are wrong more often than people expect — a phone set to 2019
 * would write events into a 2019 ClickHouse partition, where no report would
 * ever find them again. Anything beyond a day's skew is replaced with server
 * time.
 */
export function clampTimestamp(clientTs: number, receivedAt: number): number {
  if (!Number.isFinite(clientTs)) return receivedAt;
  if (Math.abs(receivedAt - clientTs) > MAX_CLOCK_SKEW_MS) return receivedAt;
  // Never accept a future timestamp; it would sort ahead of real later events.
  return Math.min(clientTs, receivedAt);
}

function clampU16(n: number | undefined): number {
  if (!n || !Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), 65535);
}
