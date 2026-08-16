import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createDatabase } from "./index";
import { createClickHouse } from "./clickhouse/client";
import { toEventRow } from "./clickhouse/rows";
import * as schema from "./schema/index";
import { loadRootEnv } from "./load-env";
import type { FalorbEvent } from "@falorb/core";

loadRootEnv();

/**
 * A burst of traffic timestamped "just now", for the live screen.
 *
 * The live view reads a short trailing window — that is what makes it live —
 * so anything the main demo seed wrote is stale within minutes and the screen
 * that exists to prove something is happening shows nothing happening. This
 * tops it up on demand, immediately before the screen is looked at.
 *
 * Reads the people it uses out of Postgres rather than inventing new ones, so
 * a visitor who appears in the live feed is a real profile in the demo
 * workspace: clicking through from the feed lands on a populated person, not a
 * ghost with one event.
 *
 *   pnpm --filter @falorb/db seed:live
 *   SEED_LIVE_COUNT=90 pnpm --filter @falorb/db seed:live
 */

const ORG_SLUG = process.env.SEED_LIVE_ORG ?? "obhox-demo";

/** Pages worth showing in a feed, per property host. */
const PAGES: Record<string, Array<[string, string]>> = {
  "linkbry.com": [
    ["/", "Linkbry — short links that report back"],
    ["/pricing", "Pricing"],
    ["/docs/api", "API reference"],
    ["/signup", "Create your workspace"],
    ["/blog/utm-builder", "Stop hand-writing UTM tags"],
    ["/dashboard", "Dashboard"],
    ["/integrations", "Integrations"],
  ],
  "letternerd.com": [
    ["/", "Letternerd"],
    ["/archive", "Archive"],
    ["/issues/the-quiet-web", "The quiet web"],
    ["/subscribe", "Subscribe"],
    ["/issues/typography-debt", "Typography debt"],
  ],
  "spendtab.com": [
    ["/", "Spendtab — spend, in one place"],
    ["/features", "Features"],
    ["/pricing", "Pricing"],
    ["/security", "Security"],
    ["/connect", "Connect an account"],
  ],
  "usebund.com": [
    ["/", "Bund AI"],
    ["/product", "Product"],
    ["/playground", "Playground"],
    ["/docs/quickstart", "Quickstart"],
    ["/pricing", "Pricing"],
  ],
  "obhox.com": [
    ["/", "Obhox — product engineering studio"],
    ["/work", "Work"],
    ["/work/spendtab", "Case study — Spendtab"],
    ["/contact", "Contact"],
  ],
};

const SOURCES: Array<[string, string, string]> = [
  ["organic_search", "Google", "google.com"],
  ["direct", "Direct", ""],
  ["organic_search", "ChatGPT", "chatgpt.com"],
  ["organic_search", "Claude", "claude.ai"],
  ["organic_social", "Hacker News", "news.ycombinator.com"],
  ["organic_social", "LinkedIn", "linkedin.com"],
  ["referral", "GitHub", "github.com"],
  ["email", "Newsletter", ""],
];

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function int(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function main(): Promise<void> {
  const count = Number(process.env.SEED_LIVE_COUNT ?? 70);
  const db = createDatabase();
  const ch = createClickHouse();
  const now = Date.now();

  const [org] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, ORG_SLUG))
    .limit(1);

  if (!org) {
    console.error(`No organization with slug "${ORG_SLUG}". Run seed:demo first.`);
    process.exit(1);
  }

  const projects = await db
    .select()
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, org.id), isNull(schema.projects.archivedAt)),
    );

  // Recently-active people first: the live feed should show the same faces the
  // rest of the dashboard is about.
  const people = await db
    .select()
    .from(schema.persons)
    .where(eq(schema.persons.organizationId, org.id))
    .orderBy(desc(schema.persons.lastSeenAt))
    .limit(400);

  if (projects.length === 0 || people.length === 0) {
    console.error("The demo workspace has no properties or no people. Run seed:demo first.");
    process.exit(1);
  }

  const events: FalorbEvent[] = [];

  for (let i = 0; i < count; i++) {
    const project = pick(projects);
    const host = project.domains[0] ?? "example.com";
    const pages = PAGES[host] ?? [["/", host]];
    const [path, title] = pick(pages);
    const person = pick(people);
    const [channel, source, referrer] = pick(SOURCES);

    // Spread across the last four minutes so the feed has a sense of pace,
    // and so "on site now" counts more than a single instant.
    const timestamp = now - int(2_000, 240_000);

    events.push({
      projectId: project.id,
      eventId: randomUUID(),
      timestamp,
      name: "$pageview",
      distinctId: person.identifiedId ?? `anon_${person.id.slice(0, 8)}`,
      personId: person.id,
      sessionId: randomUUID(),
      url: `https://${host}${path}`,
      path: path!,
      host,
      title: title!,
      referrer: referrer ? `https://${referrer}/` : "",
      referrerHost: referrer,
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
      utmTerm: "",
      utmContent: "",
      channel: channel as FalorbEvent["channel"],
      source,
      browser: person.lastBrowser ?? "Chrome",
      browserVersion: "141",
      os: person.lastOs ?? "macOS",
      osVersion: "",
      deviceType: (person.lastDeviceType ?? "desktop") as FalorbEvent["deviceType"],
      screenW: 1920,
      screenH: 1080,
      viewportW: 1920,
      viewportH: 900,
      country: person.lastCountry ?? "US",
      region: person.lastRegion ?? "",
      city: person.lastCity ?? "",
      timezone: "UTC",
      language: "en-US",
      asn: 0,
      asnOrg: "",
      companyDomain: "",
      propsStr: {},
      propsNum: { scroll_depth: int(15, 100) },
      propsRaw: "",
      revenue: null,
      currency: "",
      durationMs: int(4_000, 120_000),
      isBot: false,
      botName: "",
      ipHash: person.id.replace(/-/g, "").slice(0, 32),
      trackerVersion: "1",
    });
  }

  events.sort((a, b) => a.timestamp - b.timestamp);

  await ch.insert({
    table: "events",
    values: events.map(toEventRow),
    format: "JSONEachRow",
  });

  await ch.close();
  console.log(`inserted ${events.length} events across the last 4 minutes`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
