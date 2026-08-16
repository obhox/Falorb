import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./index";
import { createClickHouse } from "./clickhouse/client";
import { toEventRow } from "./clickhouse/rows";
import * as schema from "./schema/index";
import { loadRootEnv } from "./load-env";
import type { Channel, DeviceType, FalorbEvent } from "@falorb/core";

loadRootEnv();

/**
 * The demo workspace — the dataset the product screenshots are taken from.
 *
 * This is deliberately not `seed.ts` + `seed-events.ts`. Those exist to give a
 * developer something non-empty to build against, and their people are
 * `dev-p1-14` with no name, no company and no story. A screenshot needs the
 * opposite: every surface populated with something a reader can believe, and
 * the *same* person appearing in the people list, on a profile, inside a
 * funnel and in the live feed — because a demo where the numbers on two
 * screens contradict each other is worse than an empty one.
 *
 * So Postgres profiles and ClickHouse events are generated together from one
 * in-memory model. Totals on a profile are counted from the very events the
 * timeline renders, rather than being independently invented and drifting.
 *
 * Everything lands in its own organization, so re-running it never disturbs
 * the development seed or anybody's real workspace.
 *
 * Deterministic: a fixed PRNG seed, so the same run produces the same numbers
 * and a screenshot can be retaken later without every figure shifting.
 *
 *   pnpm --filter @falorb/db seed:demo
 *   SEED_DEMO_OWNER_EMAIL=you@example.com pnpm --filter @falorb/db seed:demo
 */

const ORG_NAME = "Obhox";
const ORG_SLUG = "obhox-demo";

/** Days of history. Long enough for the 90d ranges to have shape. */
const DAYS = 120;

/** Fixed token so the shared-dashboard screenshot has a stable URL. */
const SHARE_TOKEN = "fx8Qm2LbVn4pTwRe6YsKdH";
/** Same, for the invitation-acceptance screen. */
const INVITE_TOKEN = "hZ3vQpLmR7dNwT2sKfB9xC";

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** Mulberry32 — small, fast, reproducible across runs and platforms. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = rng(0x5eed_da7a);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

function int(min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}

function chance(p: number): boolean {
  return r() < p;
}

/** Stable UUID from a string, so ids survive a re-run unchanged. */
function uuidFrom(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// The portfolio
// ---------------------------------------------------------------------------

interface Stage {
  path: string;
  /** Share of everyone who entered the journey that reaches this page. */
  keep: number;
  title: string;
  /** Custom event fired on arrival, if any. */
  event?: string;
  /** Revenue banked here, when the person converts. */
  revenue?: number[];
}

interface ProjectSpec {
  name: string;
  slug: string;
  domains: string[];
  /** Relative traffic weight across the portfolio. */
  scale: number;
  journey: Stage[];
  /** Pages people browse outside the conversion journey. */
  browse: Array<{ path: string; title: string; tag: string }>;
  topics: string[];
  /** Fraction of visitors who are logged-in, identifiable users. */
  identifiedRate: number;
}

const PROJECTS: ProjectSpec[] = [
  {
    name: "Linkbry",
    slug: "linkbry",
    domains: ["linkbry.com", "api.linkbry.com"],
    scale: 1,
    identifiedRate: 0.34,
    journey: [
      { path: "/", keep: 1, title: "Linkbry — short links that report back" },
      { path: "/pricing", keep: 0.47, title: "Pricing" },
      { path: "/signup", keep: 0.23, title: "Create your workspace", event: "signup_started" },
      { path: "/onboarding", keep: 0.16, title: "Onboarding", event: "account_created" },
      {
        path: "/dashboard",
        keep: 0.11,
        title: "Dashboard",
        event: "workspace_created",
        revenue: [19, 19, 29, 49, 49, 99],
      },
    ],
    browse: [
      { path: "/docs", title: "Documentation", tag: "docs" },
      { path: "/docs/api", title: "API reference", tag: "docs" },
      { path: "/docs/redirects", title: "Redirect rules", tag: "docs" },
      { path: "/blog/utm-builder", title: "Stop hand-writing UTM tags", tag: "growth" },
      { path: "/blog/link-rot", title: "What link rot costs you", tag: "growth" },
      { path: "/integrations", title: "Integrations", tag: "product" },
      { path: "/changelog", title: "Changelog", tag: "product" },
    ],
    topics: ["docs", "growth", "product", "pricing", "api"],
  },
  {
    name: "Letternerd",
    slug: "letternerd",
    domains: ["letternerd.com"],
    scale: 0.72,
    identifiedRate: 0.21,
    journey: [
      { path: "/", keep: 1, title: "Letternerd" },
      { path: "/archive", keep: 0.58, title: "Archive" },
      { path: "/subscribe", keep: 0.26, title: "Subscribe", event: "subscribe_started" },
      {
        path: "/subscribe/confirmed",
        keep: 0.18,
        title: "You're in",
        event: "subscription_confirmed",
      },
    ],
    browse: [
      { path: "/issues/the-quiet-web", title: "The quiet web", tag: "writing" },
      { path: "/issues/typography-debt", title: "Typography debt", tag: "design" },
      { path: "/issues/rss-is-fine", title: "RSS is fine, actually", tag: "writing" },
      { path: "/issues/newsletter-metrics", title: "Metrics that mislead", tag: "newsletter" },
      { path: "/about", title: "About", tag: "about" },
    ],
    topics: ["writing", "design", "newsletter", "seo", "email"],
  },
  {
    name: "Spendtab",
    slug: "spendtab",
    domains: ["spendtab.com", "dashboard.spendtab.com"],
    scale: 0.55,
    identifiedRate: 0.41,
    journey: [
      { path: "/", keep: 1, title: "Spendtab — spend, in one place" },
      { path: "/features", keep: 0.51, title: "Features" },
      { path: "/pricing", keep: 0.33, title: "Pricing" },
      { path: "/signup", keep: 0.19, title: "Start a trial", event: "trial_started" },
      { path: "/connect", keep: 0.12, title: "Connect an account", event: "bank_connected" },
      {
        path: "/dashboard",
        keep: 0.08,
        title: "Dashboard",
        event: "subscription_started",
        revenue: [39, 39, 59, 99, 149, 249],
      },
    ],
    browse: [
      { path: "/security", title: "Security", tag: "security" },
      { path: "/docs/import", title: "Importing statements", tag: "docs" },
      { path: "/blog/expense-policy", title: "Write an expense policy people read", tag: "finance" },
      { path: "/customers", title: "Customers", tag: "product" },
    ],
    topics: ["finance", "security", "docs", "pricing", "product"],
  },
  {
    name: "Bund AI",
    slug: "bund",
    domains: ["usebund.com", "app.usebund.com"],
    scale: 0.61,
    identifiedRate: 0.29,
    journey: [
      { path: "/", keep: 1, title: "Bund AI" },
      { path: "/product", keep: 0.54, title: "Product" },
      { path: "/pricing", keep: 0.3, title: "Pricing" },
      { path: "/signup", keep: 0.17, title: "Sign up", event: "signup_started" },
      { path: "/playground", keep: 0.12, title: "Playground", event: "first_prompt_run" },
      {
        path: "/settings/billing",
        keep: 0.07,
        title: "Billing",
        event: "plan_upgraded",
        revenue: [29, 49, 99, 99, 199, 399],
      },
    ],
    browse: [
      { path: "/docs/quickstart", title: "Quickstart", tag: "docs" },
      { path: "/docs/models", title: "Models", tag: "docs" },
      { path: "/blog/evals", title: "Evals you can actually run", tag: "ai" },
      { path: "/blog/latency", title: "Where the latency goes", tag: "engineering" },
      { path: "/changelog", title: "Changelog", tag: "product" },
    ],
    topics: ["docs", "ai", "engineering", "product", "pricing"],
  },
  {
    name: "Obhox",
    slug: "obhox",
    domains: ["obhox.com"],
    scale: 0.33,
    identifiedRate: 0.12,
    journey: [
      { path: "/", keep: 1, title: "Obhox — product engineering studio" },
      { path: "/work", keep: 0.55, title: "Work" },
      { path: "/contact", keep: 0.21, title: "Contact", event: "contact_started" },
      {
        path: "/contact/sent",
        keep: 0.11,
        title: "Message sent",
        event: "contact_submitted",
        revenue: [2500, 4000, 6500],
      },
    ],
    browse: [
      { path: "/work/spendtab", title: "Case study — Spendtab", tag: "case-study" },
      { path: "/work/linkbry", title: "Case study — Linkbry", tag: "case-study" },
      { path: "/about", title: "About", tag: "about" },
      { path: "/writing/shipping-small", title: "Shipping small", tag: "engineering" },
    ],
    topics: ["case-study", "engineering", "consulting", "design"],
  },
];

// ---------------------------------------------------------------------------
// Acquisition, geography, devices
// ---------------------------------------------------------------------------

interface Acquisition {
  channel: Channel;
  source: string;
  referrer: string;
  weight: number;
  utm?: { source: string; medium: string; campaign: string };
}

const ACQUISITION: Acquisition[] = [
  { channel: "organic_search", source: "Google", referrer: "google.com", weight: 0.235 },
  { channel: "direct", source: "Direct", referrer: "", weight: 0.19 },
  { channel: "organic_social", source: "Hacker News", referrer: "news.ycombinator.com", weight: 0.078 },
  { channel: "organic_social", source: "LinkedIn", referrer: "linkedin.com", weight: 0.062 },
  { channel: "organic_social", source: "X", referrer: "t.co", weight: 0.055 },
  { channel: "referral", source: "GitHub", referrer: "github.com", weight: 0.042 },
  { channel: "referral", source: "Product Hunt", referrer: "producthunt.com", weight: 0.031 },
  { channel: "referral", source: "Reddit", referrer: "reddit.com", weight: 0.028 },
  // The assistants. These are what the crawlers screen pairs against agent
  // fetches — the half of the story where the reading turned into a reader.
  { channel: "organic_search", source: "ChatGPT", referrer: "chatgpt.com", weight: 0.052 },
  { channel: "organic_search", source: "Claude", referrer: "claude.ai", weight: 0.031 },
  { channel: "organic_search", source: "Perplexity", referrer: "perplexity.ai", weight: 0.024 },
  { channel: "organic_search", source: "Gemini", referrer: "gemini.google.com", weight: 0.014 },
  {
    channel: "email",
    source: "Newsletter",
    referrer: "",
    weight: 0.049,
    utm: { source: "newsletter", medium: "email", campaign: "weekly-digest" },
  },
  {
    channel: "paid_search",
    source: "Google Ads",
    referrer: "google.com",
    weight: 0.036,
    utm: { source: "google", medium: "cpc", campaign: "brand-defence-q3" },
  },
  {
    channel: "paid_social",
    source: "LinkedIn Ads",
    referrer: "linkedin.com",
    weight: 0.023,
    utm: { source: "linkedin", medium: "paid-social", campaign: "finance-leads-q3" },
  },
  { channel: "organic_search", source: "Bing", referrer: "bing.com", weight: 0.018 },
  { channel: "referral", source: "indiehackers.com", referrer: "indiehackers.com", weight: 0.012 },
];

interface Geo {
  country: string;
  region: string;
  city: string;
  timezone: string;
  language: string;
  weight: number;
}

/**
 * Where the audience is.
 *
 * Weighted to North America and Western Europe, which is where this portfolio
 * actually sells. The long tail is kept — a geography report with six rows in
 * it looks synthetic, and the rest-of-world row is what makes the top two
 * regions legible as a concentration rather than as the only thing measured.
 */
const GEOS: Geo[] = [
  // United States — ~37%
  { country: "US", region: "California", city: "San Francisco", timezone: "America/Los_Angeles", language: "en-US", weight: 0.098 },
  { country: "US", region: "New York", city: "New York", timezone: "America/New_York", language: "en-US", weight: 0.088 },
  { country: "US", region: "Texas", city: "Austin", timezone: "America/Chicago", language: "en-US", weight: 0.046 },
  { country: "US", region: "Washington", city: "Seattle", timezone: "America/Los_Angeles", language: "en-US", weight: 0.041 },
  { country: "US", region: "Illinois", city: "Chicago", timezone: "America/Chicago", language: "en-US", weight: 0.034 },
  { country: "US", region: "Massachusetts", city: "Boston", timezone: "America/New_York", language: "en-US", weight: 0.031 },
  { country: "US", region: "Colorado", city: "Denver", timezone: "America/Denver", language: "en-US", weight: 0.024 },

  // Europe — ~49%
  { country: "GB", region: "England", city: "London", timezone: "Europe/London", language: "en-GB", weight: 0.086 },
  { country: "DE", region: "Berlin", city: "Berlin", timezone: "Europe/Berlin", language: "de-DE", weight: 0.058 },
  { country: "NL", region: "North Holland", city: "Amsterdam", timezone: "Europe/Amsterdam", language: "nl-NL", weight: 0.047 },
  { country: "FR", region: "Île-de-France", city: "Paris", timezone: "Europe/Paris", language: "fr-FR", weight: 0.045 },
  { country: "DE", region: "Bavaria", city: "Munich", timezone: "Europe/Berlin", language: "de-DE", weight: 0.031 },
  { country: "IE", region: "Leinster", city: "Dublin", timezone: "Europe/Dublin", language: "en-IE", weight: 0.03 },
  { country: "SE", region: "Stockholm", city: "Stockholm", timezone: "Europe/Stockholm", language: "sv-SE", weight: 0.028 },
  { country: "ES", region: "Madrid", city: "Madrid", timezone: "Europe/Madrid", language: "es-ES", weight: 0.025 },
  { country: "GB", region: "Scotland", city: "Edinburgh", timezone: "Europe/London", language: "en-GB", weight: 0.021 },
  { country: "ES", region: "Catalonia", city: "Barcelona", timezone: "Europe/Madrid", language: "es-ES", weight: 0.02 },
  { country: "DK", region: "Capital Region", city: "Copenhagen", timezone: "Europe/Copenhagen", language: "da-DK", weight: 0.02 },
  { country: "CH", region: "Zurich", city: "Zurich", timezone: "Europe/Zurich", language: "de-CH", weight: 0.019 },
  { country: "IT", region: "Lombardy", city: "Milan", timezone: "Europe/Rome", language: "it-IT", weight: 0.019 },
  { country: "PL", region: "Masovian", city: "Warsaw", timezone: "Europe/Warsaw", language: "pl-PL", weight: 0.018 },
  { country: "PT", region: "Lisbon", city: "Lisbon", timezone: "Europe/Lisbon", language: "pt-PT", weight: 0.015 },
  { country: "NO", region: "Oslo", city: "Oslo", timezone: "Europe/Oslo", language: "nb-NO", weight: 0.014 },
  { country: "AT", region: "Vienna", city: "Vienna", timezone: "Europe/Vienna", language: "de-AT", weight: 0.012 },
  { country: "FI", region: "Uusimaa", city: "Helsinki", timezone: "Europe/Helsinki", language: "fi-FI", weight: 0.011 },

  // Everywhere else — ~14%
  { country: "CA", region: "Ontario", city: "Toronto", timezone: "America/Toronto", language: "en-CA", weight: 0.036 },
  { country: "AU", region: "New South Wales", city: "Sydney", timezone: "Australia/Sydney", language: "en-AU", weight: 0.025 },
  { country: "SG", region: "Singapore", city: "Singapore", timezone: "Asia/Singapore", language: "en-SG", weight: 0.021 },
  { country: "IN", region: "Karnataka", city: "Bengaluru", timezone: "Asia/Kolkata", language: "en-IN", weight: 0.02 },
  { country: "CA", region: "British Columbia", city: "Vancouver", timezone: "America/Vancouver", language: "en-CA", weight: 0.015 },
  { country: "JP", region: "Tokyo", city: "Tokyo", timezone: "Asia/Tokyo", language: "ja-JP", weight: 0.013 },
  { country: "BR", region: "São Paulo", city: "São Paulo", timezone: "America/Sao_Paulo", language: "pt-BR", weight: 0.009 },
];

interface Device {
  device_type: DeviceType;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  w: number;
  h: number;
  weight: number;
}

const DEVICES: Device[] = [
  { device_type: "desktop", browser: "Chrome", browserVersion: "141", os: "macOS", osVersion: "26.1", w: 2560, h: 1440, weight: 0.2 },
  { device_type: "desktop", browser: "Chrome", browserVersion: "141", os: "Windows", osVersion: "11", w: 1920, h: 1080, weight: 0.19 },
  { device_type: "mobile", browser: "Safari", browserVersion: "26", os: "iOS", osVersion: "26.1", w: 393, h: 852, weight: 0.17 },
  { device_type: "mobile", browser: "Chrome", browserVersion: "141", os: "Android", osVersion: "16", w: 412, h: 915, weight: 0.13 },
  { device_type: "desktop", browser: "Safari", browserVersion: "26", os: "macOS", osVersion: "26.1", w: 1728, h: 1117, weight: 0.09 },
  { device_type: "desktop", browser: "Firefox", browserVersion: "146", os: "Windows", osVersion: "11", w: 1920, h: 1080, weight: 0.06 },
  { device_type: "desktop", browser: "Edge", browserVersion: "141", os: "Windows", osVersion: "11", w: 1920, h: 1080, weight: 0.055 },
  { device_type: "desktop", browser: "Firefox", browserVersion: "146", os: "Linux", osVersion: "", w: 2560, h: 1440, weight: 0.045 },
  { device_type: "tablet", browser: "Safari", browserVersion: "26", os: "iPadOS", osVersion: "26.1", w: 1024, h: 1366, weight: 0.035 },
  { device_type: "mobile", browser: "Samsung Internet", browserVersion: "28", os: "Android", osVersion: "15", w: 412, h: 915, weight: 0.02 },
];

function weighted<T extends { weight: number }>(items: T[]): T {
  let x = r();
  for (const item of items) {
    if (x < item.weight) return item;
    x -= item.weight;
  }
  return items[0]!;
}

// ---------------------------------------------------------------------------
// Companies and people
//
// Invented firms and invented people. Realistic enough to read as a real
// account, deliberately not real organizations — a marketing screenshot that
// names actual companies as customers is making a claim that isn't true.
// ---------------------------------------------------------------------------

interface CompanySpec {
  domain: string;
  name: string;
  industry: string;
  employeeRange: string;
  country: string;
  asn: number;
  asnOrg: string;
}

const COMPANIES: CompanySpec[] = [
  { domain: "haldenfreight.com", name: "Halden Freight", industry: "Logistics", employeeRange: "501-1000", country: "NL", asn: 20495, asnOrg: "Halden Freight BV" },
  { domain: "meridianhealthgroup.com", name: "Meridian Health Group", industry: "Healthcare", employeeRange: "1001-5000", country: "US", asn: 14618, asnOrg: "Meridian Health Group" },
  { domain: "corvusrobotics.dev", name: "Corvus Robotics", industry: "Robotics", employeeRange: "51-200", country: "DE", asn: 24940, asnOrg: "Corvus Robotics GmbH" },
  { domain: "aldermistcapital.com", name: "Aldermist Capital", industry: "Financial services", employeeRange: "201-500", country: "GB", asn: 2856, asnOrg: "Aldermist Capital LLP" },
  { domain: "kestrelbioworks.com", name: "Kestrel Bioworks", industry: "Biotechnology", employeeRange: "51-200", country: "US", asn: 7922, asnOrg: "Kestrel Bioworks Inc" },
  { domain: "northlaneretail.co", name: "Northlane Retail", industry: "Retail", employeeRange: "1001-5000", country: "CA", asn: 812, asnOrg: "Northlane Retail Group" },
  { domain: "verdantgrid.energy", name: "Verdant Grid", industry: "Renewable energy", employeeRange: "201-500", country: "ES", asn: 12430, asnOrg: "Verdant Grid SA" },
  { domain: "solvanesystems.io", name: "Solvane Systems", industry: "Industrial software", employeeRange: "51-200", country: "SE", asn: 1257, asnOrg: "Solvane Systems AB" },
  { domain: "taborandfinch.com", name: "Tabor & Finch", industry: "Legal", employeeRange: "11-50", country: "GB", asn: 5089, asnOrg: "Tabor & Finch LLP" },
  { domain: "ironvalemfg.com", name: "Ironvale Manufacturing", industry: "Manufacturing", employeeRange: "501-1000", country: "US", asn: 701, asnOrg: "Ironvale Manufacturing Co" },
  { domain: "palmwoodmedia.com", name: "Palmwood Media", industry: "Media", employeeRange: "11-50", country: "GB", asn: 13037, asnOrg: "Palmwood Media Ltd" },
  { domain: "quillonlabs.ai", name: "Quillon Labs", industry: "AI research", employeeRange: "11-50", country: "US", asn: 396982, asnOrg: "Quillon Labs Inc" },
  { domain: "brightfoldeducation.com", name: "Brightfold Education", industry: "Education", employeeRange: "201-500", country: "AU", asn: 7545, asnOrg: "Brightfold Education Pty" },
  { domain: "westmarklogistik.de", name: "Westmark Logistik", industry: "Logistics", employeeRange: "51-200", country: "DE", asn: 8560, asnOrg: "Westmark Logistik GmbH" },
  { domain: "granlundfoods.com", name: "Granlund Foods", industry: "Food & beverage", employeeRange: "201-500", country: "SE", asn: 3301, asnOrg: "Granlund Foods AB" },
  { domain: "lintworthinsurance.co.uk", name: "Lintworth Insurance", industry: "Insurance", employeeRange: "1001-5000", country: "GB", asn: 8468, asnOrg: "Lintworth Insurance Group" },
  { domain: "nordkappanalytics.no", name: "Nordkapp Analytics", industry: "Analytics", employeeRange: "11-50", country: "NO", asn: 2119, asnOrg: "Nordkapp Analytics AS" },
  { domain: "cedarpointrealty.com", name: "Cedarpoint Realty", industry: "Real estate", employeeRange: "51-200", country: "US", asn: 22773, asnOrg: "Cedarpoint Realty LLC" },
  { domain: "arbourstack.com", name: "Arbourstack", industry: "Developer tools", employeeRange: "11-50", country: "IE", asn: 16509, asnOrg: "Arbourstack Ltd" },
  { domain: "vantessaretail.com", name: "Vantessa Retail", industry: "E-commerce", employeeRange: "201-500", country: "SG", asn: 9506, asnOrg: "Vantessa Retail Pte" },
];

/** Given names and surnames, mixed by region so the list is not monocultural. */
const FIRST_NAMES = [
  "Sarah", "Daniel", "Emma", "Michael", "Hannah", "Oliver", "Laura", "Thomas",
  "Rachel", "Christopher", "Sofia", "Lukas", "Charlotte", "Benjamin", "Elena", "Jonas",
  "Megan", "Andrew", "Clara", "Matthias", "Isabel", "Peter", "Freya", "Anders",
  "Nicole", "Stephen", "Camille", "Julien", "Anna", "Marco", "Ingrid", "Sebastian",
  "Katherine", "Patrick", "Marta", "Niklas", "Rebecca", "Adrian", "Sofie", "Tomas",
  "Julia", "Martin", "Priya", "Diego", "Amara", "Joel", "Nadia", "Felix",
];

const LAST_NAMES = [
  "Whitfield", "Harrington", "Novak", "Bergmann", "Lindqvist", "Moreau", "Kaminski", "Delaney",
  "Fitzgerald", "Hoffman", "Marchetti", "Bakker", "Larsen", "Thornbury", "Vasquez", "Lindgren",
  "Petrov", "Kowalski", "Sandoval", "Holloway", "Sorensen", "Ashford", "Quintero", "Devlin",
  "Rosenthal", "Halvorsen", "Fernandes", "Duarte", "Castellanos", "Kirkpatrick", "Ferreira", "Delacroix",
  "Brennan", "Sinclair", "Vermeer", "Schneider", "Lombardi", "Nilsson", "Okafor", "Iyer",
  "Hendricks", "Mortensen", "Beaumont", "Kovacs", "Ellery", "Rasmussen", "Aguilar", "Nakamura",
];

const ROLES = [
  "Head of Growth", "Product Manager", "Engineering Lead", "Founder",
  "Marketing Manager", "Data Analyst", "Operations Director", "CTO",
  "Content Lead", "Finance Manager", "Developer Advocate", "Solutions Engineer",
  "Head of Revenue", "Design Lead", "Customer Success Manager", "VP Engineering",
];

const PLANS = ["free", "free", "starter", "starter", "pro", "pro", "business", "enterprise"];

// ---------------------------------------------------------------------------
// Agents — the crawlers screen
// ---------------------------------------------------------------------------

const AGENTS: Array<{ name: string; weight: number; paths: "content" | "any" }> = [
  { name: "GPTBot", weight: 0.15, paths: "any" },
  { name: "ClaudeBot", weight: 0.115, paths: "any" },
  { name: "Googlebot", weight: 0.14, paths: "any" },
  { name: "ChatGPT (user)", weight: 0.095, paths: "content" },
  { name: "Claude (user)", weight: 0.062, paths: "content" },
  { name: "PerplexityBot", weight: 0.058, paths: "any" },
  { name: "Perplexity (user)", weight: 0.041, paths: "content" },
  { name: "OpenAI SearchBot", weight: 0.038, paths: "any" },
  { name: "Bingbot", weight: 0.052, paths: "any" },
  { name: "Google-Extended", weight: 0.033, paths: "any" },
  { name: "Amazonbot", weight: 0.026, paths: "any" },
  { name: "Bytespider", weight: 0.024, paths: "any" },
  { name: "CCBot", weight: 0.021, paths: "any" },
  { name: "Meta AI", weight: 0.019, paths: "any" },
  { name: "Applebot", weight: 0.018, paths: "any" },
  { name: "LinkedInBot", weight: 0.016, paths: "content" },
  { name: "Slackbot", weight: 0.014, paths: "content" },
  { name: "Twitterbot", weight: 0.012, paths: "content" },
  { name: "DuckDuckBot", weight: 0.011, paths: "any" },
  { name: "AhrefsBot", weight: 0.017, paths: "any" },
  { name: "SemrushBot", weight: 0.013, paths: "any" },
  { name: "Uptime monitor", weight: 0.01, paths: "any" },
];

// ---------------------------------------------------------------------------
// Event construction
// ---------------------------------------------------------------------------

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
    browserVersion: "",
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

/**
 * Traffic shape over the window.
 *
 * Flat traffic makes every trend line a straight bar and every delta pill
 * read "0.0%", which is the one thing a screenshot must not show. This gives
 * the period a gentle upward trend, a weekly rhythm, and one campaign spike —
 * the shapes an operator actually recognises.
 */
function dayWeight(dayAgo: number): number {
  const date = new Date(Date.now() - dayAgo * 86_400_000);
  const dow = date.getUTCDay();

  // Growth: older days are quieter. The slope is deliberate — a portfolio that
  // is flat over the window renders every delta pill as "0.0%", and a period
  // comparison that says nothing is the least useful thing a dashboard can show.
  const growth = 0.62 + 0.5 * ((DAYS - dayAgo) / DAYS);
  // Weekends are slower for B2B properties.
  const weekly = dow === 0 || dow === 6 ? 0.62 : 1;
  // A campaign burst three weeks back, decaying over four days.
  const spike = dayAgo >= 19 && dayAgo <= 22 ? 1.75 - (22 - dayAgo) * 0.14 : 1;

  return growth * weekly * spike;
}

interface PersonModel {
  id: string;
  identified: boolean;
  identifiedId: string | null;
  name: string | null;
  email: string | null;
  company: CompanySpec | null;
  traits: Record<string, unknown>;
  /** Project indexes this person is native to; the first is their home. */
  projectIndexes: number[];
  geo: Geo;
  device: Device;
  distinctIds: Array<{ projectIndex: number; distinctId: string; kind: string }>;
  events: FalorbEvent[];
  sessions: number;
  firstSeen: number;
  lastSeen: number;
  first: { channel: string; source: string; referrer: string; campaign: string; landing: string } | null;
  last: { channel: string; source: string } | null;
  revenue: number;
  topics: Map<string, number>;
}

function buildPeople(): PersonModel[] {
  const people: PersonModel[] = [];
  const now = Date.now();

  // Per-project visitor counts, weighted by the project's scale.
  const BASE = 1_150;

  let personSeq = 0;
  let identifiedSeq = 0;

  for (let pi = 0; pi < PROJECTS.length; pi++) {
    const project = PROJECTS[pi]!;
    const count = Math.round(BASE * project.scale);

    for (let n = 0; n < count; n++) {
      const key = `demo:${project.slug}:${personSeq++}`;
      const id = uuidFrom(key);
      const identified = chance(project.identifiedRate);

      let name: string | null = null;
      let email: string | null = null;
      let identifiedId: string | null = null;
      let company: CompanySpec | null = null;
      const traits: Record<string, unknown> = {};

      if (identified) {
        const first = pick(FIRST_NAMES);
        const last = pick(LAST_NAMES);
        name = `${first} ${last}`;
        company = pick(COMPANIES);
        const handle = `${first.toLowerCase()}.${last.toLowerCase()}`
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "");
        email = `${handle}@${company.domain}`;
        identifiedId = `usr_${(++identifiedSeq).toString().padStart(5, "0")}`;
        traits.name = name;
        traits.email = email;
        traits.role = pick(ROLES);
        traits.plan = pick(PLANS);
        traits.company = company.name;
      } else if (chance(0.22)) {
        // Anonymous, but the network resolved to a company. This is the B2B
        // identification case: a named account with no named person.
        company = pick(COMPANIES);
      }

      people.push({
        id,
        identified,
        identifiedId,
        name,
        email,
        company,
        traits,
        projectIndexes: [pi],
        geo: weighted(GEOS),
        device: weighted(DEVICES),
        distinctIds: [],
        events: [],
        sessions: 0,
        firstSeen: now,
        lastSeen: 0,
        first: null,
        last: null,
        revenue: 0,
        topics: new Map(),
      });
    }
  }

  // Cross-project people: the identity graph's whole reason for existing.
  // Only identified people cross, because only a shared identify() id is a
  // deterministic signal — anonymous visitors are never joined across domains.
  const identifiedPeople = people.filter((p) => p.identified);
  for (const person of identifiedPeople) {
    if (!chance(0.28)) continue;
    const extra = chance(0.25) ? 2 : 1;
    for (let i = 0; i < extra; i++) {
      const candidate = int(0, PROJECTS.length - 1);
      if (!person.projectIndexes.includes(candidate)) person.projectIndexes.push(candidate);
    }
  }

  return people;
}

/** Generate every session and event for one person. */
function generateActivity(person: PersonModel, now: number): void {
  // Returning visitors are the minority; that skew is what makes retention
  // cohorts decay instead of forming a flat block.
  const visitCount = person.identified
    ? int(2, 14)
    : chance(0.28)
      ? int(2, 5)
      : 1;

  /**
   * When this person was first seen, biased towards recent days.
   *
   * The exponent is doing real work. Return visits below cluster within days
   * of first contact, so a cohort acquired three months ago contributes almost
   * nothing to the current window — meaning the *acquisition* curve, not the
   * return curve, is what decides whether the portfolio reads as growing.
   * Skewing first contact towards the present is what makes period-over-period
   * deltas positive, and it is also just true of a portfolio that is growing.
   */
  const firstDayAgo = Math.min(DAYS - 1, Math.floor(Math.pow(r(), 1.12) * DAYS));

  /**
   * Return visits, drawn from a decaying gap distribution rather than spread
   * evenly across the remaining window. Evenly-spread returns produce a
   * retention grid that is uniform noise; real cohorts come back hard in the
   * first few days and then thin out, and that curve is the entire point of
   * the retention screen.
   */
  const GAPS = [1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 8, 11, 15, 21, 30];
  const days: number[] = [firstDayAgo];
  let cursor = firstDayAgo;
  for (let v = 1; v < visitCount; v++) {
    cursor -= pick(GAPS);
    if (cursor < 0) break;
    days.push(cursor);
  }

  for (let v = 0; v < days.length; v++) {
    const dayAgo = days[v]!;

    // Traffic shaping: drop some sessions on quiet days.
    if (r() > dayWeight(dayAgo) / 1.2) continue;

    const projectIndex =
      v === 0 || person.projectIndexes.length === 1
        ? person.projectIndexes[0]!
        : pick(person.projectIndexes);
    const project = PROJECTS[projectIndex]!;

    const distinctId =
      person.identified && v > 0
        ? person.identifiedId!
        : `anon_${person.id.slice(0, 8)}${projectIndex}`;

    if (!person.distinctIds.some((d) => d.distinctId === distinctId && d.projectIndex === projectIndex)) {
      person.distinctIds.push({
        projectIndex,
        distinctId,
        kind: distinctId.startsWith("usr_") ? "identify" : "device",
      });
    }

    const acq = weighted(ACQUISITION);
    const geo = person.geo;
    const device = person.device;
    const sessionId = uuidFrom(`session:${person.id}:${v}:${dayAgo}`);
    const host = project.domains[0]!;

    // Working hours in the visitor's own timezone, roughly.
    const hour = chance(0.75) ? int(8, 19) : int(0, 23);
    let t = now - dayAgo * 86_400_000;
    t = t - (t % 86_400_000) + hour * 3_600_000 + int(0, 59) * 60_000;
    if (t > now) t = now - int(60_000, 3_600_000);

    const sessionStart = t;

    const emit = (over: Partial<FalorbEvent>): FalorbEvent => {
      const e = blankEvent();
      Object.assign(e, {
        projectId: 0, // filled once real project ids exist
        eventId: randomUUID(),
        timestamp: t,
        distinctId,
        personId: person.id,
        sessionId,
        host,
        country: geo.country,
        region: geo.region,
        city: geo.city,
        timezone: geo.timezone,
        language: geo.language,
        deviceType: device.device_type,
        browser: device.browser,
        browserVersion: device.browserVersion,
        os: device.os,
        osVersion: device.osVersion,
        screenW: device.w,
        screenH: device.h,
        viewportW: device.w,
        viewportH: Math.round(device.h * 0.82),
        asn: person.company?.asn ?? 0,
        asnOrg: person.company?.asnOrg ?? "",
        companyDomain: person.company?.domain ?? "",
        ipHash: sha256(`ip:${person.id}:${dayAgo}`).slice(0, 32),
      } satisfies Partial<FalorbEvent>);
      Object.assign(e, over);
      (e as { _projectIndex?: number })._projectIndex = projectIndex;
      person.events.push(e);
      return e;
    };

    /**
     * Which page the session begins on.
     *
     * Not everybody arrives at the homepage. A large share of search and
     * assistant traffic lands directly on a blog post or a docs page and may
     * never touch the funnel at all — which is what gives the entry-page table
     * more than one row, the exit-rate ranking something to rank, and bounce
     * rate a believable value. Starting every session at "/" makes all three
     * screens degenerate.
     */
    const landsOnContent = chance(0.44);
    let entered = false;

    /** Mark the first event of the session as the one carrying acquisition. */
    const takeEntry = (): boolean => {
      if (entered) return false;
      entered = true;
      return true;
    };

    // Distinct pages, so a session never shows the same page three times running.
    const browsePool = [...project.browse];
    for (let i = browsePool.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [browsePool[i], browsePool[j]] = [browsePool[j]!, browsePool[i]!];
    }
    let browseCursor = 0;

    const readContent = (count: number): void => {
      for (let b = 0; b < count && browseCursor < browsePool.length; b++) {
        const page = browsePool[browseCursor++]!;
        const dwell = int(9_000, 190_000);
        const isEntry = takeEntry();
        emit({
          name: "$pageview",
          path: page.path,
          url: `https://${host}${page.path}`,
          title: page.title,
          referrer: isEntry && acq.referrer ? `https://${acq.referrer}/` : "",
          referrerHost: isEntry ? acq.referrer : "",
          channel: isEntry ? acq.channel : "internal",
          source: isEntry ? acq.source : "Internal",
          utmSource: isEntry ? (acq.utm?.source ?? "") : "",
          utmMedium: isEntry ? (acq.utm?.medium ?? "") : "",
          utmCampaign: isEntry ? (acq.utm?.campaign ?? "") : "",
          durationMs: dwell,
          propsNum: { scroll_depth: int(20, 100) },
          propsStr: { content_tag: page.tag },
        });
        if (isEntry && !person.first) {
          person.first = {
            channel: acq.channel,
            source: acq.source,
            referrer: acq.referrer,
            campaign: acq.utm?.campaign ?? "",
            landing: page.path,
          };
        }
        person.topics.set(page.tag, (person.topics.get(page.tag) ?? 0) + 1);
        t += dwell + int(2_000, 20_000);
      }
    };

    if (landsOnContent) readContent(int(1, 3));

    // -- The journey ------------------------------------------------------
    // A content reader only sometimes crosses into the funnel. That gap is the
    // "read the docs, never signed up" segment the demo also defines.
    const entersJourney = !landsOnContent || chance(0.38);
    let reached = -1;
    for (let step = 0; entersJourney && step < project.journey.length; step++) {
      const stage = project.journey[step]!;
      if (step > 0) {
        const conditional = stage.keep / project.journey[step - 1]!.keep;
        // Identified people are further along by definition — they converted
        // once already, so they progress more readily than a cold visitor.
        const boost = person.identified ? 1.35 : 1;
        if (r() > Math.min(0.95, conditional * boost)) break;
      }
      reached = step;

      const isEntry = takeEntry();
      const dwell = int(6_000, 145_000);

      emit({
        name: "$pageview",
        path: stage.path,
        url: `https://${host}${stage.path}`,
        title: stage.title,
        referrer: isEntry && acq.referrer ? `https://${acq.referrer}/` : "",
        referrerHost: isEntry ? acq.referrer : "",
        channel: isEntry ? acq.channel : "internal",
        source: isEntry ? acq.source : "Internal",
        utmSource: isEntry ? (acq.utm?.source ?? "") : "",
        utmMedium: isEntry ? (acq.utm?.medium ?? "") : "",
        utmCampaign: isEntry ? (acq.utm?.campaign ?? "") : "",
        durationMs: dwell,
        propsNum: { scroll_depth: int(12, 100) },
        propsStr: { content_tag: pick(project.topics) },
      });

      if (isEntry && !person.first) {
        person.first = {
          channel: acq.channel,
          source: acq.source,
          referrer: acq.referrer,
          campaign: acq.utm?.campaign ?? "",
          landing: stage.path,
        };
      }

      t += dwell + int(1_500, 18_000);

      if (stage.event) {
        emit({
          name: stage.event,
          path: stage.path,
          url: `https://${host}${stage.path}`,
          title: stage.title,
          channel: "internal",
          source: "Internal",
          propsStr: { plan: String(person.traits.plan ?? "free") },
        });
        t += int(500, 4_000);
      }

      // Identification happens the moment they sign in.
      if (person.identified && stage.event && stage.event.includes("account_created")) {
        emit({
          name: "$identify",
          path: stage.path,
          url: `https://${host}${stage.path}`,
          channel: "internal",
          source: "Internal",
          propsStr: { distinct_id: person.identifiedId!, email: person.email! },
        });
        t += 500;
      }

      if (stage.revenue && chance(person.identified ? 0.62 : 0.34)) {
        const amount = pick(stage.revenue);
        emit({
          name: "$revenue",
          path: stage.path,
          url: `https://${host}${stage.path}`,
          channel: "internal",
          source: "Internal",
          revenue: amount,
          currency: "USD",
          propsStr: { plan: String(person.traits.plan ?? "pro") },
        });
        person.revenue += amount;
        t += 1_000;
      }
    }

    // -- Browsing after the journey ---------------------------------------
    if (!landsOnContent && chance(0.5)) readContent(int(1, 3));

    // Nothing was emitted at all — an empty session is not a session, and
    // counting one would put the profile's session total above its timeline.
    if (!entered) continue;
    person.sessions++;

    // -- Frustration signals ----------------------------------------------
    // Concentrated on the step where most people leave, which is what makes
    // the exit-rate ranking and the rage-click count agree with each other.
    if (reached >= 1 && chance(0.09)) {
      const stage = project.journey[reached]!;
      emit({
        name: chance(0.62) ? "$rage_click" : "$error",
        path: stage.path,
        url: `https://${host}${stage.path}`,
        title: stage.title,
        channel: "internal",
        source: "Internal",
        propsStr: {
          selector: pick(["button.cta", "button[type=submit]", "a.plan-select", "form#signup"]),
          message: pick(["TypeError: cannot read properties of undefined", "Network request failed", ""]),
        },
      });
      t += int(500, 6_000);
    }

    person.firstSeen = Math.min(person.firstSeen, sessionStart);
    person.lastSeen = Math.max(person.lastSeen, t);
    person.last = { channel: acq.channel, source: acq.source };
  }
}

/** Bot and agent traffic — the subject of the crawlers screen. */
function generateAgentTraffic(projectIndex: number, project: ProjectSpec, now: number): FalorbEvent[] {
  const events: FalorbEvent[] = [];
  const host = project.domains[0]!;
  const contentPaths = project.browse.map((b) => ({ path: b.path, title: b.title }));
  const allPaths = [
    ...contentPaths,
    ...project.journey.map((j) => ({ path: j.path, title: j.title })),
  ];

  const volume = Math.round(3_400 * project.scale);

  for (let i = 0; i < volume; i++) {
    const agent = weighted(AGENTS);
    const pool = agent.paths === "content" ? contentPaths : allPaths;
    const page = pick(pool);
    // Biased towards recent days: assistant crawling of a given site has been
    // rising, and a flat agent series would make the one screen about that
    // trend the only screen with no trend in it.
    const dayAgo = Math.floor(Math.pow(r(), 1.6) * DAYS);
    const t = now - dayAgo * 86_400_000 - int(0, 86_399) * 1_000;
    if (t > now) continue;

    const e = blankEvent();
    Object.assign(e, {
      projectId: 0,
      eventId: randomUUID(),
      timestamp: t,
      name: "$pageview",
      distinctId: `bot_${sha256(agent.name).slice(0, 12)}`,
      personId: uuidFrom(`bot:${agent.name}:${projectIndex}`),
      sessionId: uuidFrom(`botsession:${agent.name}:${projectIndex}:${dayAgo}`),
      path: page.path,
      url: `https://${host}${page.path}`,
      host,
      title: page.title,
      channel: "unknown" as Channel,
      source: "",
      deviceType: "bot" as DeviceType,
      browser: "",
      os: "",
      country: pick(["US", "US", "IE", "SG", "DE", "NL"]),
      isBot: true,
      botName: agent.name,
      durationMs: 0,
      ipHash: sha256(`botip:${agent.name}`).slice(0, 32),
    } satisfies Partial<FalorbEvent>);
    (e as { _projectIndex?: number })._projectIndex = projectIndex;
    events.push(e);
  }

  return events;
}

/**
 * A burst of traffic inside the last few minutes.
 *
 * The live screen reads a short trailing window, so without this it is empty
 * at exactly the moment somebody opens it to look — the one screen whose
 * whole point is that something is happening right now.
 */
function generateLiveTraffic(people: PersonModel[], now: number): FalorbEvent[] {
  const events: FalorbEvent[] = [];
  const active = people.filter((p) => p.events.length > 0);

  // Small on purpose. This lands entirely inside the current day, and a large
  // burst there shows up on every 30-day trend as a spike on the final bucket
  // — an artefact of seeding, not a shape in the data. `seed:live` is the
  // right tool when the live screen itself is the subject.
  for (let i = 0; i < 45; i++) {
    const person = pick(active);
    const projectIndex = pick(person.projectIndexes);
    const project = PROJECTS[projectIndex]!;
    const host = project.domains[0]!;
    const page = chance(0.6)
      ? pick(project.journey).path
      : pick(project.browse).path;
    const title =
      project.journey.find((j) => j.path === page)?.title ??
      project.browse.find((b) => b.path === page)?.title ??
      page;

    const t = now - int(5_000, 290_000);
    const acq = weighted(ACQUISITION);

    const e = blankEvent();
    Object.assign(e, {
      projectId: 0,
      eventId: randomUUID(),
      timestamp: t,
      name: "$pageview",
      distinctId: person.identified ? person.identifiedId! : `anon_${person.id.slice(0, 8)}${projectIndex}`,
      personId: person.id,
      sessionId: uuidFrom(`live:${person.id}:${i}`),
      path: page,
      url: `https://${host}${page}`,
      host,
      title,
      referrer: acq.referrer ? `https://${acq.referrer}/` : "",
      referrerHost: acq.referrer,
      channel: acq.channel,
      source: acq.source,
      country: person.geo.country,
      region: person.geo.region,
      city: person.geo.city,
      timezone: person.geo.timezone,
      language: person.geo.language,
      deviceType: person.device.device_type,
      browser: person.device.browser,
      browserVersion: person.device.browserVersion,
      os: person.device.os,
      osVersion: person.device.osVersion,
      screenW: person.device.w,
      screenH: person.device.h,
      viewportW: person.device.w,
      viewportH: Math.round(person.device.h * 0.82),
      companyDomain: person.company?.domain ?? "",
      asn: person.company?.asn ?? 0,
      asnOrg: person.company?.asnOrg ?? "",
      durationMs: int(3_000, 60_000),
      propsStr: { content_tag: pick(project.topics) },
      propsNum: { scroll_depth: int(15, 100) },
      ipHash: sha256(`ip:${person.id}:live`).slice(0, 32),
    } satisfies Partial<FalorbEvent>);
    (e as { _projectIndex?: number })._projectIndex = projectIndex;
    events.push(e);

    person.lastSeen = Math.max(person.lastSeen, t);
  }

  return events;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = createDatabase();
  const ch = createClickHouse();
  const now = Date.now();

  console.log("building the demo dataset...");

  // -- Wipe any previous run -------------------------------------------------
  const [previous] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, ORG_SLUG))
    .limit(1);

  if (previous) {
    const oldProjects = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, previous.id));

    if (oldProjects.length > 0) {
      const ids = oldProjects.map((p) => p.id);
      // ClickHouse first: if this fails, the Postgres rows still point at the
      // events, and a retry is a clean retry rather than a half-deleted org.
      await ch.command({
        query: `ALTER TABLE events DELETE WHERE project_id IN (${ids.join(",")})`,
        clickhouse_settings: { mutations_sync: "2" },
      });
      for (const table of ["sessions", "person_daily", "daily_stats", "daily_paths", "daily_sources", "daily_geo", "daily_tech", "path_transitions"]) {
        await ch
          .command({
            query: `ALTER TABLE ${table} DELETE WHERE project_id IN (${ids.join(",")})`,
            clickhouse_settings: { mutations_sync: "2" },
          })
          .catch(() => undefined);
      }
    }

    // Cascades through projects, persons, aliases, funnels, goals, alerts.
    await db.delete(schema.organizations).where(eq(schema.organizations.id, previous.id));
    console.log("  removed the previous demo workspace");
  }

  // -- Organization and projects --------------------------------------------
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: ORG_NAME, slug: ORG_SLUG })
    .returning();

  const projectRows = [];
  for (const spec of PROJECTS) {
    const [row] = await db
      .insert(schema.projects)
      .values({
        organizationId: org!.id,
        name: spec.name,
        slug: spec.slug,
        domains: spec.domains,
        publicKey: "prj_" + sha256(`demo:${spec.slug}`).slice(0, 32),
        secretKeyHash: sha256(`secret:${spec.slug}`),
        timezone: "UTC",
        identityScope: "org",
        consentMode: spec.slug === "spendtab" ? "opt_in" : "off",
        retentionDays: spec.slug === "obhox" ? 400 : 760,
      })
      .returning();
    projectRows.push(row!);
  }

  const projectIdByIndex = projectRows.map((p) => p.id);
  console.log(`  ${projectRows.length} properties: ${projectRows.map((p) => `${p.slug}#${p.id}`).join(", ")}`);

  // -- Companies -------------------------------------------------------------
  const companyIdByDomain = new Map<string, string>();
  for (const spec of COMPANIES) {
    const [row] = await db
      .insert(schema.companies)
      .values({
        domain: spec.domain,
        name: spec.name,
        industry: spec.industry,
        employeeRange: spec.employeeRange,
        country: spec.country,
        website: `https://${spec.domain}`,
        linkedinUrl: `https://www.linkedin.com/company/${spec.domain.split(".")[0]}`,
        raw: { asn: spec.asn, asn_org: spec.asnOrg, source: "demo" },
        enrichedAt: new Date(now - int(1, 40) * 86_400_000),
      })
      .onConflictDoNothing()
      .returning();

    if (row) companyIdByDomain.set(spec.domain, row.id);
  }

  // Domains that already existed from a previous non-demo run.
  for (const spec of COMPANIES) {
    if (companyIdByDomain.has(spec.domain)) continue;
    const [existing] = await db
      .select({ id: schema.companies.id })
      .from(schema.companies)
      .where(eq(schema.companies.domain, spec.domain))
      .limit(1);
    if (existing) companyIdByDomain.set(spec.domain, existing.id);
  }

  // -- People and their activity --------------------------------------------
  const people = buildPeople();
  for (const person of people) generateActivity(person, now);

  const withActivity = people.filter((p) => p.events.length > 0);

  const events: FalorbEvent[] = [];
  for (const person of withActivity) events.push(...person.events);

  for (let pi = 0; pi < PROJECTS.length; pi++) {
    events.push(...generateAgentTraffic(pi, PROJECTS[pi]!, now));
  }

  events.push(...generateLiveTraffic(withActivity, now));

  // Resolve the placeholder project index into the real serial id.
  for (const event of events) {
    const index = (event as { _projectIndex?: number })._projectIndex ?? 0;
    event.projectId = projectIdByIndex[index]!;
    delete (event as { _projectIndex?: number })._projectIndex;
  }

  events.sort((a, b) => a.timestamp - b.timestamp);

  console.log(`  ${people.length} people, ${events.length} events`);

  // -- Person profiles -------------------------------------------------------
  //
  // Counted from the generated events rather than invented separately, so the
  // figure on a profile header matches the timeline underneath it.
  const personValues = withActivity.map((person) => {
    const pageviews = person.events.filter((e) => e.name === "$pageview").length;
    const projectIds = [...new Set(person.projectIndexes.map((i) => projectIdByIndex[i]!))];

    for (const event of person.events) {
      const tag = event.propsStr?.content_tag;
      if (typeof tag === "string" && tag) {
        person.topics.set(tag, (person.topics.get(tag) ?? 0) + 1);
      }
    }

    const interestScores: Record<string, number> = {};
    const ranked = [...person.topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const top = ranked[0]?.[1] ?? 1;
    for (const [topic, count] of ranked) {
      interestScores[topic] = Math.round((count / top) * 100) / 100;
    }

    // A blend of depth, breadth and money — the same ingredients the scorer
    // worker uses, so the demo does not teach a ranking the product disagrees
    // with.
    // Weighted so the top of the range is earned rather than reached by most
    // identified people: a column where two thirds of the rows read 100 sorts
    // nothing and tells the reader nothing.
    const leadScore = Math.min(
      100,
      Math.round(
        person.sessions * 1.6 +
          pageviews * 0.45 +
          projectIds.length * 5 +
          (person.identified ? 12 : 0) +
          (person.company ? 4 : 0) +
          Math.min(15, person.revenue / 40),
      ),
    );

    return {
      id: person.id,
      organizationId: org!.id,
      projectIds,
      identifiedId: person.identifiedId,
      email: person.email,
      name: person.name,
      traits: person.traits,
      interestScores,
      companyId: person.company ? (companyIdByDomain.get(person.company.domain) ?? null) : null,
      firstSeenAt: new Date(person.firstSeen),
      lastSeenAt: new Date(person.lastSeen),
      firstChannel: person.first?.channel ?? "direct",
      firstSource: person.first?.source ?? "Direct",
      firstReferrerHost: person.first?.referrer ?? "",
      firstUtmCampaign: person.first?.campaign ?? "",
      firstLandingPath: person.first?.landing ?? "/",
      lastChannel: person.last?.channel ?? "direct",
      lastSource: person.last?.source ?? "Direct",
      lastCountry: person.geo.country,
      lastRegion: person.geo.region,
      lastCity: person.geo.city,
      lastDeviceType: person.device.device_type,
      lastBrowser: person.device.browser,
      lastOs: person.device.os,
      totalSessions: person.sessions,
      totalEvents: person.events.length,
      totalPageviews: pageviews,
      totalRevenue: person.revenue.toFixed(4),
      leadScore,
    };
  });

  for (let i = 0; i < personValues.length; i += 500) {
    await db.insert(schema.persons).values(personValues.slice(i, i + 500));
  }

  const aliasValues = withActivity.flatMap((person) =>
    person.distinctIds.map((alias) => ({
      personId: person.id,
      projectId: projectIdByIndex[alias.projectIndex]!,
      distinctId: alias.distinctId,
      kind: alias.kind,
      firstSeenAt: new Date(person.firstSeen),
      lastSeenAt: new Date(person.lastSeen),
    })),
  );

  for (let i = 0; i < aliasValues.length; i += 500) {
    await db.insert(schema.personAliases).values(aliasValues.slice(i, i + 500)).onConflictDoNothing();
  }

  console.log(`  ${personValues.length} profiles, ${aliasValues.length} aliases`);

  // -- Merge history ---------------------------------------------------------
  // Every identified person who crossed properties was, at some point, two
  // anonymous profiles. The audit of that is what makes a bad merge reversible.
  const merged = withActivity.filter((p) => p.identified && p.projectIndexes.length > 1).slice(0, 24);
  if (merged.length > 0) {
    await db.insert(schema.personMerges).values(
      merged.map((person) => ({
        organizationId: org!.id,
        survivorId: person.id,
        mergedId: uuidFrom(`merged:${person.id}`),
        reason: "identify" as const,
        mergedSnapshot: {
          email: null,
          totalSessions: int(1, 4),
          firstSeenAt: new Date(person.firstSeen).toISOString(),
        },
        aliasCount: person.distinctIds.length,
        createdAt: new Date(person.lastSeen - int(1, 20) * 86_400_000),
      })),
    );
  }

  // -- ClickHouse ------------------------------------------------------------
  const CHUNK = 5_000;
  for (let i = 0; i < events.length; i += CHUNK) {
    await ch.insert({
      table: "events",
      values: events.slice(i, i + CHUNK).map(toEventRow),
      format: "JSONEachRow",
    });
  }
  console.log(`  inserted ${events.length} events into ClickHouse`);

  await seedAnalysis(db, org!.id, projectRows);
  await seedOps(db, org!.id, projectRows);
  await attachOwner(db, org!.id, projectRows);

  await ch.close();
  console.log("\ndone.\n");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Saved analysis objects
// ---------------------------------------------------------------------------

type ProjectRow = typeof schema.projects.$inferSelect;

async function seedAnalysis(
  db: ReturnType<typeof createDatabase>,
  organizationId: string,
  projects: ProjectRow[],
): Promise<void> {
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const linkbry = bySlug.get("linkbry")!;
  const spendtab = bySlug.get("spendtab")!;
  const bund = bySlug.get("bund")!;
  const letternerd = bySlug.get("letternerd")!;
  const obhox = bySlug.get("obhox")!;

  await db.insert(schema.funnels).values([
    {
      projectId: linkbry.id,
      name: "Visitor to paying workspace",
      description: "The full acquisition path, from landing to a workspace that has been paid for.",
      steps: [
        { label: "Landed", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/" }] },
        { label: "Saw pricing", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/pricing" }] },
        { label: "Started signup", event: "signup_started" },
        { label: "Created account", event: "account_created" },
        { label: "Created workspace", event: "workspace_created" },
      ],
      windowHours: 168,
    },
    {
      projectId: linkbry.id,
      name: "Docs to signup",
      description: "Do the people who read the API reference ever sign up?",
      steps: [
        { label: "Read the docs", event: "$pageview", filters: [{ field: "path", op: "starts_with", value: "/docs" }] },
        { label: "Saw pricing", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/pricing" }] },
        { label: "Started signup", event: "signup_started" },
      ],
      windowHours: 336,
    },
    {
      projectId: spendtab.id,
      name: "Trial to subscription",
      description: "Where finance teams stall between starting a trial and connecting an account.",
      steps: [
        { label: "Landed", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/" }] },
        { label: "Saw features", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/features" }] },
        { label: "Started trial", event: "trial_started" },
        { label: "Connected a bank", event: "bank_connected" },
        { label: "Subscribed", event: "subscription_started" },
      ],
      windowHours: 336,
    },
    {
      projectId: bund.id,
      name: "Signup to first prompt",
      description: "Activation: an account is worth nothing until a prompt has run.",
      steps: [
        { label: "Signed up", event: "signup_started" },
        { label: "Opened the playground", event: "$pageview", filters: [{ field: "path", op: "eq", value: "/playground" }] },
        { label: "Ran a prompt", event: "first_prompt_run" },
        { label: "Upgraded", event: "plan_upgraded" },
      ],
      windowHours: 168,
    },
    {
      projectId: letternerd.id,
      name: "Reader to subscriber",
      steps: [
        { label: "Read an issue", event: "$pageview", filters: [{ field: "path", op: "starts_with", value: "/issues" }] },
        { label: "Opened subscribe", event: "subscribe_started" },
        { label: "Confirmed", event: "subscription_confirmed" },
      ],
      windowHours: 72,
    },
  ]);

  await db.insert(schema.goals).values([
    { projectId: linkbry.id, name: "Workspace created", kind: "event", matcher: "workspace_created", value: "49.0000", currency: "USD" },
    { projectId: linkbry.id, name: "Signup started", kind: "event", matcher: "signup_started", currency: "USD" },
    { projectId: linkbry.id, name: "Reached the dashboard", kind: "path", matcher: "/dashboard*", currency: "USD" },
    { projectId: linkbry.id, name: "Newsletter referral", kind: "event", matcher: "referral_shared", currency: "USD", active: false },
    { projectId: spendtab.id, name: "Subscription started", kind: "event", matcher: "subscription_started", value: "99.0000", currency: "USD" },
    { projectId: spendtab.id, name: "Bank connected", kind: "event", matcher: "bank_connected", currency: "USD" },
    { projectId: spendtab.id, name: "Trial started", kind: "event", matcher: "trial_started", value: "25.0000", currency: "USD" },
    { projectId: bund.id, name: "Plan upgraded", kind: "event", matcher: "plan_upgraded", value: "99.0000", currency: "USD" },
    { projectId: bund.id, name: "First prompt run", kind: "event", matcher: "first_prompt_run", currency: "USD" },
    { projectId: letternerd.id, name: "Subscription confirmed", kind: "event", matcher: "subscription_confirmed", value: "4.0000", currency: "USD" },
    { projectId: obhox.id, name: "Enquiry submitted", kind: "event", matcher: "contact_submitted", value: "4000.0000", currency: "USD" },
  ]);

  await db.insert(schema.segments).values([
    {
      organizationId,
      projectId: null,
      name: "Multi-product accounts",
      description: "People who have used more than one property. The reason the identity graph exists.",
      definition: { and: [{ field: "path", op: "is_set" }] },
      cachedCount: 214,
      cachedAt: new Date(),
    },
    {
      organizationId,
      projectId: linkbry.id,
      name: "Read the docs, never signed up",
      description: "High intent, no conversion — the cheapest audience there is.",
      definition: {
        and: [
          { field: "path", op: "starts_with", value: "/docs" },
          { not: { field: "name", op: "eq", value: "signup_started" } },
        ],
      },
      cachedCount: 486,
      cachedAt: new Date(),
    },
    {
      organizationId,
      projectId: null,
      name: "Arrived from an assistant",
      description: "Traffic referred by ChatGPT, Claude, Perplexity or Gemini.",
      definition: { or: [{ field: "source", op: "in", value: ["ChatGPT", "Claude", "Perplexity", "Gemini"] }] },
      cachedCount: 733,
      cachedAt: new Date(),
    },
    {
      organizationId,
      projectId: spendtab.id,
      name: "Finance teams in the EU",
      description: "Named accounts in EU countries that reached pricing.",
      definition: {
        and: [
          { field: "country", op: "in", value: ["DE", "NL", "FR", "ES", "SE", "PL", "IE", "NO"] },
          { field: "path", op: "eq", value: "/pricing" },
        ],
      },
      cachedCount: 168,
      cachedAt: new Date(),
    },
    {
      organizationId,
      projectId: null,
      name: "Rage-clicked in the last 30 days",
      description: "Anyone who hit the same control repeatedly. Frustration, ranked.",
      definition: { and: [{ field: "name", op: "eq", value: "$rage_click" }] },
      cachedCount: 97,
      cachedAt: new Date(),
    },
  ]);

  const insightRows = await db
    .insert(schema.insights)
    .values([
      {
        organizationId,
        projectId: null,
        name: "Visitors by channel",
        kind: "breakdown",
        query: { metric: "visitors", dimension: "channel", range: "30d" },
        visualization: { chart: "bars" },
      },
      {
        organizationId,
        projectId: null,
        name: "Revenue across the portfolio",
        kind: "trend",
        query: { metric: "revenue", interval: "day", range: "90d" },
        visualization: { chart: "line" },
      },
      {
        organizationId,
        projectId: linkbry.id,
        name: "Signups by country",
        kind: "breakdown",
        query: { metric: "visitors", dimension: "country", range: "30d", event: "signup_started" },
        visualization: { chart: "bars" },
      },
      {
        organizationId,
        projectId: null,
        name: "Assistant referrals over time",
        kind: "trend",
        query: { metric: "visitors", interval: "week", range: "90d", filters: [{ field: "source", op: "in", value: ["ChatGPT", "Claude", "Perplexity"] }] },
        visualization: { chart: "area" },
      },
      {
        organizationId,
        projectId: spendtab.id,
        name: "Weekly retention",
        kind: "retention",
        query: { period: "week", periods: 8, range: "90d" },
        visualization: { chart: "cohort" },
      },
    ])
    .returning();

  const [dashboard] = await db
    .insert(schema.dashboards)
    .values({
      organizationId,
      projectId: null,
      name: "Portfolio weekly",
      layout: {
        [insightRows[0]!.id]: { x: 0, y: 0, w: 6, h: 4 },
        [insightRows[1]!.id]: { x: 6, y: 0, w: 6, h: 4 },
        [insightRows[3]!.id]: { x: 0, y: 4, w: 12, h: 4 },
      },
      publicToken: SHARE_TOKEN,
      isDefault: true,
    })
    .returning();

  await db.insert(schema.dashboardWidgets).values(
    insightRows.slice(0, 4).map((insight, position) => ({
      dashboardId: dashboard!.id,
      insightId: insight.id,
      title: insight.name,
      overrides: position === 3 ? { range: "30d" } : {},
      position,
    })),
  );

  console.log("  funnels, goals, segments, insights and a shared dashboard");
}

// ---------------------------------------------------------------------------
// Alerts, webhooks, keys, audit
// ---------------------------------------------------------------------------

async function seedOps(
  db: ReturnType<typeof createDatabase>,
  organizationId: string,
  projects: ProjectRow[],
): Promise<void> {
  const now = Date.now();
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const linkbry = bySlug.get("linkbry")!;
  const spendtab = bySlug.get("spendtab")!;
  const bund = bySlug.get("bund")!;

  const channels = await db
    .insert(schema.alertChannels)
    .values([
      { organizationId, name: "#analytics", kind: "slack", config: { webhookUrl: "encrypted:slack", channel: "#analytics" } },
      { organizationId, name: "Growth team", kind: "email", config: { recipients: ["growth@obhox.com", "joy@obhox.com"] } },
      { organizationId, name: "On-call webhook", kind: "webhook", config: { url: "https://hooks.obhox.com/falorb" } },
    ])
    .returning();

  const alertRows = await db
    .insert(schema.alerts)
    .values([
      {
        organizationId,
        projectId: linkbry.id,
        channelId: channels[0]!.id,
        name: "Signups fell against last week",
        kind: "anomaly",
        condition: { metric: "sessions", changePercent: 35, direction: "drop", windowMinutes: 1440, compareOffsetMinutes: 10080 },
        schedule: "0 * * * *",
        cooldownMinutes: 240,
        lastEvaluatedAt: new Date(now - 12 * 60_000),
        lastFiredAt: new Date(now - 2 * 86_400_000),
      },
      {
        organizationId,
        projectId: null,
        channelId: channels[1]!.id,
        name: "Portfolio traffic below floor",
        kind: "threshold",
        condition: { metric: "visitors", operator: "lt", value: 400, windowMinutes: 1440 },
        schedule: "*/30 * * * *",
        cooldownMinutes: 720,
        lastEvaluatedAt: new Date(now - 4 * 60_000),
      },
      {
        organizationId,
        projectId: spendtab.id,
        channelId: channels[2]!.id,
        name: "Errors spiking on connect",
        kind: "error_spike",
        condition: { metric: "events", changePercent: 60, direction: "rise", windowMinutes: 60 },
        schedule: "*/15 * * * *",
        cooldownMinutes: 60,
        lastEvaluatedAt: new Date(now - 6 * 60_000),
        lastFiredAt: new Date(now - 9 * 3_600_000),
      },
      {
        organizationId,
        projectId: bund.id,
        channelId: channels[0]!.id,
        name: "No events received",
        kind: "no_data",
        condition: { windowMinutes: 120 },
        schedule: "*/15 * * * *",
        cooldownMinutes: 180,
        lastEvaluatedAt: new Date(now - 9 * 60_000),
      },
      {
        organizationId,
        projectId: spendtab.id,
        channelId: channels[1]!.id,
        name: "Revenue below weekly target",
        kind: "threshold",
        condition: { metric: "revenue", operator: "lt", value: 2500, windowMinutes: 10080 },
        schedule: "0 9 * * 1",
        cooldownMinutes: 1440,
        active: false,
        lastEvaluatedAt: new Date(now - 3 * 86_400_000),
      },
    ])
    .returning();

  await db.insert(schema.alertEvents).values([
    {
      alertId: alertRows[0]!.id,
      status: "fired",
      observedValue: "412",
      expectedValue: "≥ 690",
      message: "Sessions on Linkbry fell 40.3% against the same window last week.",
      deliveredAt: new Date(now - 2 * 86_400_000),
      createdAt: new Date(now - 2 * 86_400_000),
    },
    {
      alertId: alertRows[0]!.id,
      status: "resolved",
      observedValue: "731",
      expectedValue: "≥ 690",
      message: "Recovered — sessions back within the expected band.",
      deliveredAt: new Date(now - 34 * 3_600_000),
      createdAt: new Date(now - 34 * 3_600_000),
    },
    {
      alertId: alertRows[2]!.id,
      status: "fired",
      observedValue: "87 errors/hr",
      expectedValue: "≤ 54/hr",
      message: "$error on /connect rose 61% in the last hour.",
      deliveredAt: new Date(now - 9 * 3_600_000),
      createdAt: new Date(now - 9 * 3_600_000),
    },
    {
      alertId: alertRows[2]!.id,
      status: "error",
      message: "Webhook delivery failed: 503 from hooks.obhox.com",
      deliveryError: "503 Service Unavailable",
      createdAt: new Date(now - 8 * 3_600_000),
    },
    {
      alertId: alertRows[3]!.id,
      status: "resolved",
      observedValue: "1,204 events",
      message: "Events resumed after 34 minutes of silence.",
      deliveredAt: new Date(now - 5 * 86_400_000),
      createdAt: new Date(now - 5 * 86_400_000),
    },
  ]);

  await db.insert(schema.webhooks).values([
    {
      organizationId,
      projectId: linkbry.id,
      url: "https://hooks.obhox.com/falorb/conversions",
      triggers: ["workspace_created", "plan_upgraded"],
      secret: randomBytes(24).toString("hex"),
      lastDeliveryAt: new Date(now - 41 * 60_000),
    },
    {
      organizationId,
      projectId: null,
      url: "https://api.obhox.com/internal/analytics-events",
      triggers: ["$revenue"],
      secret: randomBytes(24).toString("hex"),
      failureCount: 2,
      lastDeliveryAt: new Date(now - 6 * 3_600_000),
    },
  ]);

  await db.insert(schema.apiKeys).values([
    {
      organizationId,
      projectId: null,
      name: "Reporting export",
      keyHash: sha256("demo-key-reporting"),
      keyPrefix: "flb_rp_8Kd2",
      scopes: ["read:events", "read:persons"],
      lastUsedAt: new Date(now - 3 * 3_600_000),
    },
    {
      organizationId,
      projectId: linkbry.id,
      name: "Linkbry server SDK",
      keyHash: sha256("demo-key-linkbry"),
      keyPrefix: "flb_sk_Qm71",
      scopes: ["write:events"],
      lastUsedAt: new Date(now - 9 * 60_000),
    },
    {
      organizationId,
      projectId: null,
      name: "Retired CI key",
      keyHash: sha256("demo-key-ci"),
      keyPrefix: "flb_sk_Zx40",
      scopes: ["write:events"],
      revokedAt: new Date(now - 21 * 86_400_000),
      lastUsedAt: new Date(now - 23 * 86_400_000),
    },
  ]);

  console.log("  alert rules with firing history, webhooks and API keys");
}

// ---------------------------------------------------------------------------
// Owner, team and invitations
// ---------------------------------------------------------------------------

async function attachOwner(
  db: ReturnType<typeof createDatabase>,
  organizationId: string,
  projects: ProjectRow[],
): Promise<void> {
  const email = process.env.SEED_DEMO_OWNER_EMAIL?.trim();

  // Teammates. These are accounts, not visitors — the people who use the
  // dashboard, which is a different population from the people it reports on.
  const TEAM = [
    { name: "Daniel Whitfield", email: "daniel@obhox.com", role: "admin" as const },
    { name: "Amara Okafor", email: "amara@obhox.com", role: "member" as const },
    { name: "Priya Iyer", email: "priya@obhox.com", role: "member" as const },
    { name: "Jonas Bergmann", email: "jonas@obhox.com", role: "viewer" as const },
  ];

  const memberIds: string[] = [];
  for (const member of TEAM) {
    const id = sha256(`demo-user:${member.email}`).slice(0, 32);
    await db
      .insert(schema.user)
      .values({
        id,
        name: member.name,
        email: member.email,
        emailVerified: true,
        createdAt: new Date(Date.now() - int(40, 300) * 86_400_000),
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .insert(schema.memberships)
      .values({ organizationId, userId: id, role: member.role })
      .onConflictDoNothing();

    memberIds.push(id);
  }

  await db.insert(schema.invitations).values([
    {
      organizationId,
      email: "rebecca.holloway@obhox.com",
      role: "member",
      tokenHash: sha256(INVITE_TOKEN),
      invitedBy: memberIds[0] ?? null,
      expiresAt: new Date(Date.now() + 6 * 86_400_000),
    },
    {
      organizationId,
      email: "samuel.osei@obhox.com",
      role: "viewer",
      tokenHash: sha256(randomBytes(16).toString("hex")),
      invitedBy: memberIds[0] ?? null,
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
    },
  ]);

  await db.insert(schema.auditLog).values([
    { organizationId, actorId: memberIds[0] ?? null, action: "project.created", targetType: "project", targetId: String(projects[0]!.id), metadata: { name: projects[0]!.name }, createdAt: new Date(Date.now() - 26 * 86_400_000) },
    { organizationId, actorId: memberIds[0] ?? null, action: "api_key.created", targetType: "api_key", targetId: "flb_rp_8Kd2", metadata: { scopes: ["read:events"] }, createdAt: new Date(Date.now() - 14 * 86_400_000) },
    { organizationId, actorId: memberIds[1] ?? null, action: "funnel.created", targetType: "funnel", targetId: "visitor-to-paying", metadata: { steps: 5 }, createdAt: new Date(Date.now() - 9 * 86_400_000) },
    { organizationId, actorId: memberIds[0] ?? null, action: "dashboard.shared", targetType: "dashboard", targetId: "portfolio-weekly", metadata: { public: true }, createdAt: new Date(Date.now() - 5 * 86_400_000) },
    { organizationId, actorId: memberIds[0] ?? null, action: "member.invited", targetType: "invitation", targetId: "rebecca.holloway@obhox.com", metadata: { role: "member" }, createdAt: new Date(Date.now() - 2 * 86_400_000) },
    { organizationId, actorId: memberIds[2] ?? null, action: "api_key.revoked", targetType: "api_key", targetId: "flb_sk_Zx40", metadata: {}, createdAt: new Date(Date.now() - 21 * 86_400_000) },
  ]);

  if (!email) {
    console.log(
      "\n  No owner account attached. Sign up in the dashboard, then re-run with:\n" +
        "    SEED_DEMO_OWNER_EMAIL=you@example.com pnpm --filter @falorb/db seed:demo\n",
    );
    return;
  }

  const [user] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  if (!user) {
    console.log(`\n  No account with email ${email}. Sign up first, then re-run.\n`);
    return;
  }

  await db
    .insert(schema.memberships)
    .values({ organizationId, userId: user.id, role: "owner" })
    .onConflictDoNothing();

  console.log(`\n  ${email} owns the demo workspace.`);
  console.log(`  Shared dashboard:  /share/${SHARE_TOKEN}`);
  console.log(`  Pending invite:    /invite/${INVITE_TOKEN}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
