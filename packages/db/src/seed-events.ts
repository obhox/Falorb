import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createClickHouse } from "./clickhouse/client";
import { createDatabase } from "./index";
import * as schema from "./schema/index";
import { toEventRow } from "./clickhouse/rows";
import type { Channel, DeviceType, FalorbEvent } from "@falorb/core";
import { loadRootEnv } from "./load-env";

loadRootEnv();

/**
 * Development event generator.
 *
 * Produces a realistic multi-day, multi-project, multi-person dataset so the
 * query layer can be exercised against something with actual shape — funnels
 * that partially convert, cohorts that decay, pages that lose people. Uniform
 * random data would make every one of those look flat and hide real bugs.
 *
 * Deterministic: seeded PRNG, so a failing query can be reproduced exactly.
 */

const CH_DEFAULTS = {
  days: 30,
  peoplePerProject: 120,
};

/** Mulberry32 — small, fast, and reproducible across runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuidFrom(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

interface ProjectSpec {
  /** Resolved from `slug` at run time — see `resolveProjectIds`. */
  id: number;
  slug: string;
  host: string;
  /** Ordered journey; each step has a probability of being reached. */
  funnel: Array<{ path: string; keep: number }>;
  content: string[];
}

/**
 * Point the specs at the projects that actually exist.
 *
 * These ids used to be hardcoded as 1, 2, 3 — correct only on a database whose
 * very first seed run created them. On any instance seeded more than once the
 * events landed on whatever happened to hold those ids, which was usually an
 * organization nobody was a member of. The symptom is the worst kind: the seed
 * reports success, and the dashboard shows an empty workspace.
 */
async function resolveProjectIds(): Promise<void> {
  const db = createDatabase();

  for (const project of PROJECTS) {
    const [row] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.slug, project.slug))
      .limit(1);

    if (!row) {
      throw new Error(
        `No project "${project.slug}". Run \`pnpm db:seed\` first — it creates the ` +
          "projects this generator writes events for.",
      );
    }
    project.id = row.id;
  }

  console.log(
    `writing to ${PROJECTS.map((p) => `${p.slug}=${p.id}`).join(", ")}`,
  );
}

const PROJECTS: ProjectSpec[] = [
  {
    id: 0,
    slug: "acme",
    host: "acme.example",
    funnel: [
      { path: "/", keep: 1 },
      { path: "/work", keep: 0.55 },
      { path: "/contact", keep: 0.3 },
      { path: "/contact/sent", keep: 0.12 },
    ],
    content: ["consulting", "engineering", "design"],
  },
  {
    id: 0,
    slug: "beacon",
    host: "beacon.example",
    funnel: [
      { path: "/", keep: 1 },
      { path: "/pricing", keep: 0.62 },
      { path: "/signup", keep: 0.28 },
      { path: "/onboarding", keep: 0.19 },
    ],
    content: ["product", "growth"],
  },
  {
    id: 0,
    slug: "notewell",
    host: "notewell.example",
    funnel: [
      { path: "/", keep: 1 },
      { path: "/blog", keep: 0.7 },
      { path: "/subscribe", keep: 0.24 },
      { path: "/subscribe/confirmed", keep: 0.15 },
    ],
    content: ["writing", "newsletter", "seo", "email"],
  },
];

const CHANNELS: Array<{
  channel: Channel;
  source: string;
  referrer: string;
  weight: number;
}> = [
  { channel: "organic_search", source: "Google", referrer: "google.com", weight: 0.34 },
  { channel: "direct", source: "Direct", referrer: "", weight: 0.26 },
  { channel: "organic_social", source: "Hacker News", referrer: "news.ycombinator.com", weight: 0.14 },
  { channel: "organic_social", source: "X", referrer: "t.co", weight: 0.1 },
  { channel: "referral", source: "someblog.dev", referrer: "someblog.dev", weight: 0.08 },
  { channel: "email", source: "Newsletter", referrer: "", weight: 0.05 },
  { channel: "paid_search", source: "Google", referrer: "google.com", weight: 0.03 },
];

const GEO = [
  { country: "NG", region: "Lagos", city: "Lagos" },
  { country: "US", region: "California", city: "San Francisco" },
  { country: "GB", region: "England", city: "London" },
  { country: "DE", region: "Berlin", city: "Berlin" },
  { country: "IN", region: "Karnataka", city: "Bengaluru" },
  { country: "CA", region: "Ontario", city: "Toronto" },
];

const DEVICES: Array<{
  device_type: DeviceType;
  browser: string;
  os: string;
  w: number;
  h: number;
}> = [
  { device_type: "desktop", browser: "Chrome", os: "macOS", w: 2560, h: 1440 },
  { device_type: "desktop", browser: "Chrome", os: "Windows", w: 1920, h: 1080 },
  { device_type: "mobile", browser: "Safari", os: "iOS", w: 390, h: 844 },
  { device_type: "mobile", browser: "Chrome", os: "Android", w: 412, h: 915 },
  { device_type: "tablet", browser: "Safari", os: "iOS", w: 820, h: 1180 },
];

function weightedChannel(r: () => number) {
  let x = r();
  for (const c of CHANNELS) {
    if (x < c.weight) return c;
    x -= c.weight;
  }
  return CHANNELS[0]!;
}

function blankEvent(): FalorbEvent {
  return {
    projectId: 0,
    eventId: "",
    timestamp: 0,
    name: "",
    distinctId: "",
    personId: "",
    sessionId: "",
    url: "",
    path: "",
    host: "",
    title: "",
    referrer: "",
    referrerHost: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmTerm: "",
    utmContent: "",
    channel: "direct",
    source: "Direct",
    browser: "",
    browserVersion: "131",
    os: "",
    osVersion: "",
    deviceType: "desktop",
    screenW: 0,
    screenH: 0,
    viewportW: 0,
    viewportH: 0,
    country: "",
    region: "",
    city: "",
    timezone: "UTC",
    language: "en-GB",
    asn: 0,
    asnOrg: "",
    companyDomain: "",
    propsStr: {},
    propsNum: {},
    propsRaw: "",
    revenue: null,
    currency: "",
    durationMs: 0,
    isBot: false,
    botName: "",
    ipHash: "",
    trackerVersion: "1",
  };
}

async function main(): Promise<void> {
  const days = Number(process.env.SEED_DAYS ?? CH_DEFAULTS.days);
  const perProject = Number(process.env.SEED_PEOPLE ?? CH_DEFAULTS.peoplePerProject);
  await resolveProjectIds();

  const r = rng(20260816);
  const client = createClickHouse();
  const now = Date.now();
  const events: FalorbEvent[] = [];

  for (const project of PROJECTS) {
    for (let p = 0; p < perProject; p++) {
      const personKey = `p${project.id}-${p}`;
      const personId = uuidFrom(`person:${personKey}`);
      const distinctId = `dev-${personKey}`;

      // A minority of people return; that skew is what makes retention cohorts
      // decay realistically instead of forming a flat block.
      const visits = r() < 0.25 ? 1 + Math.floor(r() * 5) : 1;
      const firstDayAgo = Math.floor(r() * days);

      for (let v = 0; v < visits; v++) {
        const dayAgo = Math.max(0, firstDayAgo - Math.floor(r() * firstDayAgo || 0) - v);
        const sessionStart =
          now - dayAgo * 86_400_000 - Math.floor(r() * 20 * 3_600_000);
        const sessionId = uuidFrom(`session:${personKey}:${v}`);
        const acq = weightedChannel(r);
        const geo = pick(r, GEO);
        const dev = pick(r, DEVICES);

        let t = sessionStart;
        let reached = 0;
        for (let step = 0; step < project.funnel.length; step++) {
          const stage = project.funnel[step]!;
          if (step > 0 && r() > stage.keep / project.funnel[step - 1]!.keep) break;
          reached = step;

          const e = blankEvent();
          e.projectId = project.id;
          e.eventId = randomUUID();
          e.timestamp = t;
          e.name = "$pageview";
          e.distinctId = distinctId;
          e.personId = personId;
          e.sessionId = sessionId;
          e.path = stage.path;
          e.host = project.host;
          e.url = `https://${project.host}${stage.path}`;
          e.title = stage.path;
          e.referrer = step === 0 && acq.referrer ? `https://${acq.referrer}/` : "";
          e.referrerHost = step === 0 ? acq.referrer : "";
          e.channel = step === 0 ? acq.channel : "internal";
          e.source = step === 0 ? acq.source : "Internal";
          if (acq.channel === "paid_search") {
            e.utmSource = "google";
            e.utmMedium = "cpc";
            e.utmCampaign = "brand-2026";
          }
          e.country = geo.country;
          e.region = geo.region;
          e.city = geo.city;
          e.deviceType = dev.device_type;
          e.browser = dev.browser;
          e.os = dev.os;
          e.screenW = dev.w;
          e.screenH = dev.h;
          e.viewportW = dev.w;
          e.viewportH = Math.round(dev.h * 0.8);
          e.durationMs = 5_000 + Math.floor(r() * 90_000);
          e.propsNum = { scroll_depth: Math.min(100, 10 + Math.floor(r() * 95)) };
          e.propsStr = { content_tag: pick(r, project.content) };
          e.ipHash = createHash("sha256").update(`ip:${personKey}`).digest("hex").slice(0, 32);
          events.push(e);

          t += e.durationMs + Math.floor(r() * 15_000);
        }

        // Frustration signals concentrated on the step where most people leave.
        if (reached >= 1 && r() < 0.12) {
          const e = blankEvent();
          Object.assign(e, {
            projectId: project.id,
            eventId: randomUUID(),
            timestamp: t,
            name: r() < 0.6 ? "$rage_click" : "$error",
            distinctId,
            personId,
            sessionId,
            path: project.funnel[reached]!.path,
            host: project.host,
            url: `https://${project.host}${project.funnel[reached]!.path}`,
            country: geo.country,
            deviceType: dev.device_type,
            browser: dev.browser,
            os: dev.os,
            channel: "internal",
            source: "Internal",
            propsStr: { selector: "button.cta" },
          });
          events.push(e);
        }

        // Revenue on full conversion, for the attribution reports.
        if (reached === project.funnel.length - 1 && r() < 0.5) {
          const e = blankEvent();
          Object.assign(e, {
            projectId: project.id,
            eventId: randomUUID(),
            timestamp: t + 1000,
            name: "$revenue",
            distinctId,
            personId,
            sessionId,
            path: project.funnel[reached]!.path,
            host: project.host,
            url: `https://${project.host}${project.funnel[reached]!.path}`,
            channel: "internal",
            source: "Internal",
            country: geo.country,
            deviceType: dev.device_type,
            browser: dev.browser,
            os: dev.os,
            revenue: [19, 49, 99, 199][Math.floor(r() * 4)]!,
            currency: "USD",
          });
          events.push(e);
        }
      }
    }
  }

  // A handful of people who use more than one product — the cross-project case.
  for (let i = 0; i < 25; i++) {
    const personId = uuidFrom(`person:p1-${i}`);
    for (const project of [PROJECTS[1]!, PROJECTS[2]!]) {
      const e = blankEvent();
      Object.assign(e, {
        projectId: project.id,
        eventId: randomUUID(),
        timestamp: now - Math.floor(r() * 10 * 86_400_000),
        name: "$pageview",
        distinctId: `dev-p1-${i}`,
        personId,
        sessionId: uuidFrom(`session:cross:${i}:${project.id}`),
        path: "/",
        host: project.host,
        url: `https://${project.host}/`,
        channel: "internal",
        source: "Internal",
        country: "NG",
        deviceType: "desktop",
        browser: "Chrome",
        os: "macOS",
        propsStr: { content_tag: project.content[0]! },
      });
      events.push(e);
    }
  }

  events.sort((a, b) => a.timestamp - b.timestamp);

  // Insert in chunks; a single multi-hundred-thousand-row body would be a
  // needlessly large HTTP request.
  const CHUNK = 5000;
  for (let i = 0; i < events.length; i += CHUNK) {
    await client.insert({
      table: "events",
      values: events.slice(i, i + CHUNK).map(toEventRow),
      format: "JSONEachRow",
    });
  }

  await client.close();
  console.log(`inserted ${events.length} events across ${PROJECTS.length} projects over ${days} days`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
