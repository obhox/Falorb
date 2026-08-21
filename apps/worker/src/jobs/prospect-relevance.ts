import { complete, AiSignalError, type AiCredentials } from "@falorb/ai";
import { describeProspectSource } from "@falorb/core";

/**
 * AI relevance scoring, shared by every listener job (`reddit-listener.ts`,
 * `hackernews-listener.ts`, `job-listener.ts`) — one prompt shape, one
 * parser, so a listening source is a new caller of this module rather than
 * its own copy of the scoring logic. Originally lived inside
 * `reddit-listener.ts` before Hacker News and job-posting listening made the
 * duplication real.
 *
 * `propertySummary` (from `projects.profileSummary`, populated by
 * `property-profiler.ts`) is optional and the prompt degrades gracefully
 * without it — a brand-new property has nothing crawled yet, and scoring
 * must not block on that.
 */

export interface RelevanceInput {
  source: string;
  projectName: string;
  propertySummary: string | null;
  keyword: string;
  title: string;
  excerpt: string;
  /** The organization's own AI gateway when it has connected one (see
   * `resolveAiCredentials`); null falls back to the deployment's key. */
  credentials?: AiCredentials | null;
}

export async function scoreProspectRelevance(
  input: RelevanceInput,
): Promise<{ score: number; rationale: string } | null> {
  const sourceDescription = describeProspectSource(input.source);

  const systemPrompt =
    `You score how likely a ${input.source} match is to be a genuine sales/outreach ` +
    `opportunity for "${input.projectName}". ${sourceDescription} ` +
    (input.propertySummary ? `What "${input.projectName}" actually does: ${input.propertySummary} ` : "") +
    "Judge relevance against the matched keyword and the item's own content. Reply with " +
    'exactly two lines: "SCORE: <integer 0-100>" then "WHY: <one short sentence>". ' +
    "0 means unrelated or purely coincidental keyword match; 100 means someone is " +
    "actively asking for (or, for a job posting, hiring to solve) a problem this " +
    "product addresses. No other text.";

  let text: string;
  try {
    text = await complete(
      systemPrompt,
      { project: input.projectName, matchedKeyword: input.keyword, title: input.title, excerpt: input.excerpt },
      { maxTokens: 100, stripMarkdown: false, credentials: input.credentials },
    );
  } catch (error) {
    if (error instanceof AiSignalError) return null;
    throw error;
  }

  return parseRelevanceResponse(text);
}

/** Pulled out so the parsing itself is unit-testable without a gateway call. */
export function parseRelevanceResponse(text: string): { score: number; rationale: string } | null {
  const scoreMatch = text.match(/SCORE:\s*(\d{1,3})/i);
  const whyMatch = text.match(/WHY:\s*(.+)/i);
  if (!scoreMatch) return null;

  return {
    score: Math.max(0, Math.min(100, Number(scoreMatch[1]))),
    rationale: whyMatch?.[1]?.trim() ?? "",
  };
}
