import type { Channel } from "./events";
import type { Utm } from "./url";

/**
 * Referrer -> source/channel classification.
 *
 * The browser only ever hands us the referring *host* (and increasingly not
 * even the path, thanks to default `strict-origin-when-cross-origin`). That
 * host is the entirety of legitimate "which other sites is this person on"
 * data available to a first-party analytics tool, so it is worth classifying
 * well.
 *
 * Lookup keys are matched against three candidates per host, most specific
 * first — see `candidateKeys`. That lets `t.co` resolve to X while `t.me`
 * resolves to Telegram, which a single-label scheme cannot express.
 */

const SEARCH_ENGINES: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  yahoo: "Yahoo",
  yandex: "Yandex",
  baidu: "Baidu",
  ecosia: "Ecosia",
  "search.brave": "Brave Search",
  startpage: "Startpage",
  qwant: "Qwant",
  naver: "Naver",
  seznam: "Seznam",
  // LLM assistants increasingly send real referral traffic and are worth
  // separating from ordinary search in reporting.
  perplexity: "Perplexity",
  chatgpt: "ChatGPT",
  openai: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  phind: "Phind",
  "you.com": "You.com",
};

const SOCIAL: Record<string, string> = {
  facebook: "Facebook",
  "fb.com": "Facebook",
  "l.facebook": "Facebook",
  instagram: "Instagram",
  "l.instagram": "Instagram",
  twitter: "X",
  "x.com": "X",
  "t.co": "X",
  linkedin: "LinkedIn",
  "lnkd.in": "LinkedIn",
  reddit: "Reddit",
  "out.reddit": "Reddit",
  pinterest: "Pinterest",
  tiktok: "TikTok",
  youtube: "YouTube",
  "youtu.be": "YouTube",
  threads: "Threads",
  "bsky.app": "Bluesky",
  mastodon: "Mastodon",
  discord: "Discord",
  slack: "Slack",
  "t.me": "Telegram",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  "wa.me": "WhatsApp",
  snapchat: "Snapchat",
  tumblr: "Tumblr",
  quora: "Quora",
  medium: "Medium",
  substack: "Substack",
  "news.ycombinator": "Hacker News",
  producthunt: "Product Hunt",
  indiehackers: "Indie Hackers",
  "dev.to": "DEV",
  github: "GitHub",
  stackoverflow: "Stack Overflow",
};

const EMAIL_HOSTS = new Set([
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
  "mail.yahoo.com",
  "mail.proton.me",
  "mail.zoho.com",
  "superhuman.com",
  "hey.com",
]);

const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "paid",
  "paidsearch",
  "paid_search",
  "cpm",
  "cpv",
  "cpa",
  "cpp",
  "retargeting",
  "sem",
]);

const SOCIAL_MEDIUMS = new Set(["social", "social-network", "sm", "social_media"]);
const EMAIL_MEDIUMS = new Set(["email", "e-mail", "newsletter", "mail"]);

/**
 * Second-level domains that behave as public suffixes. Without these,
 * `google.co.uk` would reduce to the meaningless key `co`.
 */
const MULTI_PART_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "co.jp",
  "co.kr",
  "co.in",
  "com.br",
  "com.mx",
  "com.tr",
  "com.sg",
  "com.hk",
]);

/**
 * Candidate lookup keys for a host, most specific first.
 *
 * `news.ycombinator.com` -> ["news.ycombinator.com", "news.ycombinator", "ycombinator"]
 * `google.co.uk`         -> ["google.co.uk", "google", "google"]
 * `t.co`                 -> ["t.co", "t", "t"]
 */
function candidateKeys(host: string): string[] {
  const clean = host.toLowerCase().replace(/^www\./, "");
  const parts = clean.split(".");
  if (parts.length <= 1) return [clean];

  const lastTwo = parts.slice(-2).join(".");
  const suffixLength = MULTI_PART_TLDS.has(lastTwo) ? 2 : 1;

  const withoutTld = parts.slice(0, Math.max(1, parts.length - suffixLength));
  const registrableLabel = withoutTld[withoutTld.length - 1] ?? clean;

  return [clean, withoutTld.join("."), registrableLabel];
}

function lookup(table: Record<string, string>, host: string): string | undefined {
  for (const key of candidateKeys(host)) {
    const hit = table[key];
    if (hit) return hit;
  }
  return undefined;
}

export interface Classification {
  /** Human-readable source, e.g. "Google", "Hacker News", or a bare hostname. */
  source: string;
  channel: Channel;
  referrerHost: string;
}

export interface ClassifyInput {
  referrer: string | undefined;
  utm: Utm;
  /** Host of the page being viewed, used to detect internal navigation. */
  selfHost: string;
  /** Other hosts belonging to the same project — also treated as internal. */
  ownHosts?: readonly string[];
}

export function classifyReferrer(input: ClassifyInput): Classification {
  const { utm, selfHost } = input;
  const referrerHost = hostOf(input.referrer);
  const { medium, source: utmSource } = utm;

  // UTM tags are an explicit statement of intent by whoever built the link, so
  // they take precedence over whatever the browser reports as the referrer.
  if (medium && EMAIL_MEDIUMS.has(medium)) {
    return { source: titleize(utmSource) || "Email", channel: "email", referrerHost };
  }
  if (medium && PAID_MEDIUMS.has(medium)) {
    const channel: Channel = isSocialHost(utmSource) ? "paid_social" : "paid_search";
    return { source: titleize(utmSource) || "Paid", channel, referrerHost };
  }
  if (medium && SOCIAL_MEDIUMS.has(medium)) {
    return {
      source: titleize(utmSource) || "Social",
      channel: "organic_social",
      referrerHost,
    };
  }
  if (medium === "affiliate") {
    return { source: titleize(utmSource) || "Affiliate", channel: "affiliate", referrerHost };
  }
  if (medium === "display" || medium === "banner") {
    return { source: titleize(utmSource) || "Display", channel: "display", referrerHost };
  }
  if (medium === "video") {
    return { source: titleize(utmSource) || "Video", channel: "video", referrerHost };
  }
  if (utmSource && !referrerHost) {
    return { source: titleize(utmSource), channel: "referral", referrerHost };
  }

  // No usable UTM — fall back to the referrer header.
  if (!referrerHost) {
    return { source: "Direct", channel: "direct", referrerHost: "" };
  }

  const ownHosts = input.ownHosts ?? [];
  if (referrerHost === selfHost || ownHosts.includes(referrerHost)) {
    return { source: "Internal", channel: "internal", referrerHost };
  }
  if (EMAIL_HOSTS.has(referrerHost)) {
    return { source: "Email", channel: "email", referrerHost };
  }

  const search = lookup(SEARCH_ENGINES, referrerHost);
  if (search) return { source: search, channel: "organic_search", referrerHost };

  const social = lookup(SOCIAL, referrerHost);
  if (social) return { source: social, channel: "organic_social", referrerHost };

  return { source: referrerHost, channel: "referral", referrerHost };
}

function isSocialHost(source: string): boolean {
  if (!source) return false;
  return Boolean(lookup(SOCIAL, source));
}

function hostOf(referrer: string | undefined): string {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function titleize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
