import "server-only";
import { ResearchUnavailableError, search } from "@falorb/research";
import { complete } from "@/server/ai";
import { getResearchClients } from "@/server/integrations";

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

/**
 * Best-effort external research folded into the draft prompt, or null when
 * unavailable. `search()` picks exactly one connected provider (Exa,
 * falling back to Firecrawl only if there's no Exa connection or Exa itself
 * errors) — this never combines both for one topic. Each is either this
 * property's own connection (Settings → Integrations on the property) or,
 * absent that, the organization's — a property and an organization that
 * have connected neither just skip this step.
 */
async function researchTopic(topic: string, organizationId: string, projectId: number): Promise<string | null> {
  const clients = await getResearchClients(organizationId, projectId);
  let results: Awaited<ReturnType<typeof search>>;
  try {
    results = await search(clients, topic, { limit: 5 });
  } catch (error) {
    if (error instanceof ResearchUnavailableError) return null;
    throw error;
  }
  if (!results.length) return null;

  const snippets = results
    .map((r) => `- ${r.title ?? r.url} (${r.url}): ${r.text.slice(0, 500)}`)
    .join("\n");

  return `What already ranks for "${topic}" on the open web:\n${snippets}`;
}

export async function generateContentDraft(
  topic: string,
  contextData: unknown,
  projectName: string,
  organizationId: string,
  projectId: number,
): Promise<ContentDraft> {
  const research = await researchTopic(topic, organizationId, projectId);

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
