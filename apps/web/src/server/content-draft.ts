import "server-only";
import { complete } from "@/server/ai";
import { ExaApiError, FirecrawlApiError, scrapeUrl, searchWeb } from "@/server/research";

/**
 * Turns a "rising interest, thin coverage" topic into a draft landing/content
 * page: a title, a meta description, and a markdown body ready to paste into
 * a CMS — closing the gap between "people want this" and "there's a page
 * for it" in one click instead of leaving it as a table row to act on later.
 *
 * Asked for as one structured-text response with clear delimiters rather
 * than JSON: a chat model asked for JSON routinely wraps it in prose or a
 * code fence, and parsing three delimited fields out of plain text tolerates
 * that better than hoping for valid JSON. `stripMarkdown: false` is the
 * point of this call — every other `complete()` caller wants plain prose,
 * but this output IS a content page body.
 */
export interface ContentDraft {
  title: string;
  metaDescription: string;
  body: string;
}

const BODY_DELIMITER = "---";

/** Best-effort external research folded into the draft prompt, or null when unavailable. */
async function researchTopic(topic: string): Promise<string | null> {
  let results: Awaited<ReturnType<typeof searchWeb>>;
  try {
    results = await searchWeb(topic, { numResults: 5, textCharLimit: 500 });
  } catch (error) {
    // EXA_API_KEY unset, or Exa itself unreachable/erroring — the draft still
    // generates from interest data alone, same graceful-degrade shape as
    // every other optional integration in this codebase.
    if (error instanceof ExaApiError) return null;
    throw error;
  }
  if (!results.length) return null;

  // The single best match gets a full Firecrawl scrape — cleaner, more
  // complete markdown than Exa's inline snippet — so the draft can ground
  // itself in one real page's actual structure and depth, not just titles.
  let scraped: string | null = null;
  const top = results[0];
  if (top) {
    try {
      const page = await scrapeUrl(top.url, { timeoutMs: 15_000 });
      scraped = `Closest existing page (${page.url}):\n${page.markdown.slice(0, 3000)}`;
    } catch (error) {
      if (!(error instanceof FirecrawlApiError)) throw error;
      // Scrape failed (blocked, unset key, timed out) — the search snippets below still help.
    }
  }

  const snippets = results
    .map((r) => `- ${r.title ?? r.url} (${r.url})${r.text ? `: ${r.text}` : ""}`)
    .join("\n");

  return [
    `What already ranks for "${topic}" on the open web:`,
    snippets,
    scraped,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function generateContentDraft(
  topic: string,
  contextData: unknown,
  projectName: string,
): Promise<ContentDraft> {
  const research = await researchTopic(topic);

  const systemPrompt =
    `You are a content strategist writing a new landing/content page for ${projectName}. ` +
    `The topic is "${topic}": visitors are already searching for or landing near this ` +
    "topic but there is almost no content serving it yet on this property, and you are " +
    "closing that gap. You are given the visitor-interest data behind this topic" +
    (research
      ? ", plus real research on what already exists elsewhere on the web for it — use " +
        "it to write something more specific and differentiated than a generic overview, " +
        "not to copy it"
      : "") +
    ". Write a complete page for it. Respond with EXACTLY this structure and nothing else: a " +
    'first line starting with "TITLE: " followed by the page title (under 60 ' +
    'characters), a second line starting with "META: " followed by a meta description ' +
    `(under 160 characters), then a line containing only "${BODY_DELIMITER}", then the ` +
    "full page body written in markdown (headings, paragraphs, and lists as " +
    "appropriate) — several hundred words, genuinely useful to a visitor interested in " +
    "this topic, not a stub.";

  const raw = await complete(
    systemPrompt,
    { topic, projectName, interestContext: contextData, ...(research ? { research } : {}) },
    { maxTokens: 2000, stripMarkdown: false },
  );

  return parseContentDraft(raw, topic);
}

function parseContentDraft(raw: string, topic: string): ContentDraft {
  const lines = raw.split("\n");
  let title = "";
  let metaDescription = "";
  let bodyStart = -1;

  for (const [i, line] of lines.entries()) {
    const titleMatch = line.match(/^TITLE:\s*(.+)$/i);
    const metaMatch = line.match(/^META:\s*(.+)$/i);
    if (titleMatch?.[1]) {
      title = titleMatch[1].trim();
    } else if (metaMatch?.[1]) {
      metaDescription = metaMatch[1].trim();
    } else if (line.trim() === BODY_DELIMITER) {
      bodyStart = i + 1;
      break;
    }
  }

  const body = (bodyStart === -1 ? lines.slice(2) : lines.slice(bodyStart)).join("\n").trim();

  return {
    title: title || `A guide to ${topic}`,
    metaDescription: metaDescription || `Learn more about ${topic}.`,
    body: body || raw.trim(),
  };
}
