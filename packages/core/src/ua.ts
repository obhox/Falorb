import type { DeviceType } from "./events";

/**
 * Compact user-agent parsing.
 *
 * Deliberately not `ua-parser-js`: that library is ~30KB and walks hundreds of
 * regexes per call, which is real cost on an ingest hot path handling every
 * pageview. This table covers the browsers that actually appear in western
 * web traffic and degrades to "Other" rather than guessing.
 *
 * Order is load-bearing. Edge advertises "Chrome", Chrome advertises "Safari",
 * and nearly every in-app browser advertises all three — so the most specific
 * pattern must be tested first.
 */

export interface UaResult {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: DeviceType;
  isBot: boolean;
  botName: string;
}

/**
 * Bot signatures. Matched case-insensitively against the raw UA. Traffic
 * flagged here is stored (so crawl volume stays visible) but excluded from
 * every visitor-facing metric by default.
 */
const BOT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/googlebot|google-inspectiontool|storebot-google/i, "Googlebot"],
  [/bingbot|bingpreview|adidxbot/i, "Bingbot"],
  /* AI agents, split by *why* they are here — the two behaviours are wholly
     different events and collapsing them loses the more valuable one.

     A "(user)" agent means a person asked an assistant about this page and it
     fetched the page to answer them: a real reader, arriving through a
     different door. The bare crawler is bulk ingestion for training or an
     index, with no person attached and no visit to follow.

     Ordered specific-before-general, since the bare names are substrings of
     nothing but the generic catch-all still waits at the end. */
  [/chatgpt-user/i, "ChatGPT (user)"],
  [/oai-searchbot/i, "OpenAI SearchBot"],
  [/gptbot/i, "GPTBot"],
  [/claude-user|claude-web/i, "Claude (user)"],
  [/claudebot|anthropic-ai/i, "ClaudeBot"],
  [/perplexity-user/i, "Perplexity (user)"],
  [/perplexitybot/i, "PerplexityBot"],
  [/google-extended/i, "Google-Extended"],
  [/bytespider/i, "Bytespider"],
  [/meta-externalagent/i, "Meta AI"],
  [/amazonbot/i, "Amazonbot"],
  [/ccbot/i, "CCBot"],
  [/applebot/i, "Applebot"],
  [/duckduckbot/i, "DuckDuckBot"],
  [/yandexbot|yandeximages/i, "YandexBot"],
  [/baiduspider/i, "Baiduspider"],
  [/ahrefsbot/i, "AhrefsBot"],
  [/semrushbot/i, "SemrushBot"],
  [/mj12bot|dotbot|blexbot|petalbot|dataforseo/i, "SEO crawler"],
  [/facebookexternalhit|facebookcatalog/i, "Facebook"],
  [/twitterbot/i, "Twitterbot"],
  [/linkedinbot/i, "LinkedInBot"],
  [/slackbot|slack-imgproxy/i, "Slackbot"],
  [/discordbot/i, "Discordbot"],
  [/telegrambot/i, "TelegramBot"],
  [/whatsapp/i, "WhatsApp"],
  [/pingdom|uptimerobot|statuscake|betteruptime|newrelicpinger/i, "Uptime monitor"],
  [/lighthouse|chrome-lighthouse|pagespeed|gtmetrix/i, "Performance audit"],
  [/headlesschrome|puppeteer|playwright|phantomjs|selenium/i, "Headless browser"],
  [/curl|wget|python-requests|go-http-client|axios|node-fetch|okhttp|java\//i, "HTTP client"],
  // Generic catch-all, tested last so named bots keep their identity.
  [/bot|crawler|spider|crawl|scraper|archiver|fetcher/i, "Other bot"],
];

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/edg(?:e|a|ios)?\/([\d.]+)/i, "Edge"],
  [/opr\/([\d.]+)/i, "Opera"],
  [/opera(?:.*version)?[/ ]([\d.]+)/i, "Opera"],
  [/samsungbrowser\/([\d.]+)/i, "Samsung Internet"],
  [/ucbrowser\/([\d.]+)/i, "UC Browser"],
  [/yabrowser\/([\d.]+)/i, "Yandex Browser"],
  [/vivaldi\/([\d.]+)/i, "Vivaldi"],
  [/brave\/([\d.]+)/i, "Brave"],
  [/duckduckgo\/([\d.]+)/i, "DuckDuckGo"],
  [/fxios\/([\d.]+)/i, "Firefox"],
  [/firefox\/([\d.]+)/i, "Firefox"],
  [/crios\/([\d.]+)/i, "Chrome"],
  [/chrome\/([\d.]+)/i, "Chrome"],
  [/version\/([\d.]+).*safari/i, "Safari"],
  [/safari\/([\d.]+)/i, "Safari"],
  [/msie ([\d.]+)|trident.*rv:([\d.]+)/i, "Internet Explorer"],
];

const OPERATING_SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/windows nt ([\d.]+)/i, "Windows"],
  [/android[ /]([\d.]+)/i, "Android"],
  // iPadOS 13+ reports a desktop-class UA; `deviceType` corrects for that below.
  [/(?:iphone|ipad|ipod).*os ([\d_]+)/i, "iOS"],
  [/mac os x ([\d_.]+)/i, "macOS"],
  [/cros [^ ]+ ([\d.]+)/i, "ChromeOS"],
  [/ubuntu[ /]?([\d.]*)/i, "Ubuntu"],
  [/(?:fedora|red hat|centos)[ /]?([\d.]*)/i, "Fedora"],
  [/linux/i, "Linux"],
];

/** Windows NT build numbers are meaningless to a human; map to marketing names. */
const WINDOWS_VERSIONS: Record<string, string> = {
  "10.0": "10/11",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
};

const EMPTY: UaResult = {
  browser: "Other",
  browserVersion: "",
  os: "Other",
  osVersion: "",
  deviceType: "unknown",
  isBot: false,
  botName: "",
};

export function parseUserAgent(ua: string | undefined | null): UaResult {
  if (!ua) return { ...EMPTY };

  for (const [pattern, name] of BOT_PATTERNS) {
    if (pattern.test(ua)) {
      return { ...EMPTY, deviceType: "bot", isBot: true, botName: name };
    }
  }

  const result: UaResult = { ...EMPTY };

  for (const [pattern, name] of BROWSERS) {
    const m = pattern.exec(ua);
    if (m) {
      result.browser = name;
      result.browserVersion = majorVersion(m[1] ?? m[2]);
      break;
    }
  }

  for (const [pattern, name] of OPERATING_SYSTEMS) {
    const m = pattern.exec(ua);
    if (m) {
      result.os = name;
      const raw = (m[1] ?? "").replace(/_/g, ".");
      result.osVersion =
        name === "Windows" ? (WINDOWS_VERSIONS[raw] ?? raw) : majorVersion(raw);
      break;
    }
  }

  result.deviceType = detectDeviceType(ua, result.os);
  return result;
}

function detectDeviceType(ua: string, os: string): DeviceType {
  if (/\b(smart-?tv|googletv|appletv|hbbtv|netcast|viera|roku|crkey)\b/i.test(ua)) {
    return "tv";
  }
  if (/\bipad\b/i.test(ua) || /\btablet\b/i.test(ua) || /\bkindle|silk\b/i.test(ua)) {
    return "tablet";
  }
  // Android without "Mobile" in the token is, by Google's own convention, a tablet.
  if (os === "Android" && !/\bmobile\b/i.test(ua)) return "tablet";
  if (/\bmobile\b|\biphone\b|\bipod\b|\bwindows phone\b/i.test(ua)) return "mobile";
  if (os === "iOS") return "mobile";
  if (os === "Other") return "unknown";
  return "desktop";
}

/**
 * Keep only the major version. Full version strings explode the cardinality of
 * a LowCardinality ClickHouse column for no analytical benefit — nobody
 * segments on Chrome 131.0.6778.86 versus 131.0.6778.85.
 */
function majorVersion(v: string | undefined): string {
  if (!v) return "";
  return v.split(".")[0] ?? "";
}
