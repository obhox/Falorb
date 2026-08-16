/**
 * How AI assistants use this site.
 *
 * The question this answers is not "how many bots hit me" — it is what ChatGPT,
 * Claude, Perplexity and the rest are doing with the content, and whether any
 * of it comes back as readers.
 *
 * Two behaviours matter and they are opposites:
 *
 *   **Answering** — a person asked an assistant something, and the assistant
 *   fetched this page to answer them. There is a real human on the other end.
 *   The visit does not appear in visitor metrics, because the assistant read
 *   the page, not the person.
 *
 *   **Ingesting** — bulk crawling for a training corpus or a search index. No
 *   person is attached and none follows. This is the traffic robots.txt is
 *   for, if you want less of it.
 *
 * The ingest classifier keeps these apart by user-agent (`chatgpt-user` versus
 * `gptbot`, and so on), which is what makes the distinction reportable at all.
 *
 * Names mirror `packages/core/src/ua.ts`. They are duplicated rather than
 * imported because that module classifies a user-agent string while this one
 * groups an already-classified name.
 */

export type AgentKind = "ai-answering" | "ai-ingesting" | "search" | "social" | "tooling" | "other";

/** An assistant fetching a page because a person asked about it. */
const AI_ANSWERING = new Set(["ChatGPT (user)", "Claude (user)", "Perplexity (user)"]);

/** Bulk collection for a corpus or an index. */
const AI_INGESTING = new Set([
  "GPTBot",
  "ClaudeBot",
  "PerplexityBot",
  "OpenAI SearchBot",
  "Google-Extended",
  "Meta AI",
  "Bytespider",
  "Amazonbot",
  "CCBot",
]);

const SEARCH = new Set([
  "Googlebot",
  "Bingbot",
  "Applebot",
  "DuckDuckBot",
  "YandexBot",
  "Baiduspider",
]);

const SOCIAL = new Set([
  "Facebook",
  "Twitterbot",
  "LinkedInBot",
  "Slackbot",
  "Discordbot",
  "TelegramBot",
  "WhatsApp",
]);

const TOOLING = new Set([
  "AhrefsBot",
  "SemrushBot",
  "SEO crawler",
  "Uptime monitor",
  "Performance audit",
  "Headless browser",
  "HTTP client",
]);

export function classify(botName: string): AgentKind {
  if (AI_ANSWERING.has(botName)) return "ai-answering";
  if (AI_INGESTING.has(botName)) return "ai-ingesting";
  if (SEARCH.has(botName)) return "search";
  if (SOCIAL.has(botName)) return "social";
  if (TOOLING.has(botName)) return "tooling";
  return "other";
}

export function isAi(botName: string): boolean {
  const kind = classify(botName);
  return kind === "ai-answering" || kind === "ai-ingesting";
}

export const KIND_LABELS: Record<AgentKind, string> = {
  "ai-answering": "AI answering someone",
  "ai-ingesting": "AI ingesting content",
  search: "Search engines",
  social: "Link previews",
  tooling: "SEO & monitoring",
  other: "Unclassified",
};

export const KIND_NOTES: Record<AgentKind, string> = {
  "ai-answering":
    "A person asked an assistant about this page and it fetched the page to answer. A real reader you never see in visitor metrics.",
  "ai-ingesting":
    "Bulk collection for a training corpus or an index. No person attached, and none follows.",
  search: "Indexing you so people can find you. This is what search traffic is built on.",
  social: "Fetching a preview because someone shared a link.",
  tooling: "Your own monitoring, or somebody's SEO tool. Not an audience.",
  other: "Matched the generic bot signature without a specific name.",
};

/** Which assistant an agent belongs to, so the two halves can be paired up. */
export const AGENT_VENDOR: Record<string, string> = {
  "ChatGPT (user)": "OpenAI",
  "OpenAI SearchBot": "OpenAI",
  GPTBot: "OpenAI",
  "Claude (user)": "Anthropic",
  ClaudeBot: "Anthropic",
  "Perplexity (user)": "Perplexity",
  PerplexityBot: "Perplexity",
  "Google-Extended": "Google",
  "Meta AI": "Meta",
  Bytespider: "ByteDance",
  Amazonbot: "Amazon",
  CCBot: "Common Crawl",
};

/**
 * How to stop an agent, for the operator's next move.
 *
 * All of these honour robots.txt under the user-agent token given. Blocking an
 * "answering" agent is a real trade: it stops the ingestion, and it also stops
 * the assistant being able to describe your page accurately to someone who
 * asked about it.
 */
export const ROBOTS_TOKEN: Record<string, string> = {
  GPTBot: "GPTBot",
  "ChatGPT (user)": "ChatGPT-User",
  "OpenAI SearchBot": "OAI-SearchBot",
  ClaudeBot: "ClaudeBot",
  "Claude (user)": "Claude-User",
  PerplexityBot: "PerplexityBot",
  "Perplexity (user)": "Perplexity-User",
  "Google-Extended": "Google-Extended",
  "Meta AI": "meta-externalagent",
  Bytespider: "Bytespider",
  Amazonbot: "Amazonbot",
  CCBot: "CCBot",
};

/**
 * Referrer sources that are AI assistants sending a person to you.
 *
 * The referrer classifier already names these, but files them under
 * organic_search — so they are identified here by source name rather than by
 * channel. This is the other half of the story: the assistant read you, and
 * then somebody actually clicked through.
 */
export const AI_REFERRER_SOURCES = new Set([
  "ChatGPT",
  "Claude",
  "Perplexity",
  "Gemini",
  "Copilot",
  "Phind",
  "You.com",
]);
