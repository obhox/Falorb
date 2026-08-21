import { complete } from "@falorb/ai";
import { fetchPage, ResearchUnavailableError, type ResearchClients } from "./orchestrate";

/**
 * Builds a property's prospecting profile from its own homepage — the
 * counterpart to `apps/web/src/server/company-research.ts`'s `researchCompany`,
 * but for a property Falorb tracks rather than a lead's employer. A bare
 * project name gives social-listening relevance scoring and outreach drafts
 * nothing to reason with beyond "does this post mention the name" — this
 * fills in what the product actually does, who it's for, and what's worth
 * listening for, once, from a real crawl rather than a guess.
 *
 * Callers (the `property-profiler` worker job, and the manual "Re-crawl"
 * settings action) build their own `ResearchClients` from the organization's
 * stored `integrationConnections` — this module never reads credentials
 * itself, same separation `orchestrate.ts` already draws.
 */
export class PropertyResearchError extends Error {}

export interface PropertyProfileResult {
  summary: string | null;
  icp: string | null;
  keyFeatures: string[];
  suggestedKeywords: string[];
}

export async function researchProperty(
  clients: ResearchClients,
  name: string,
  domain: string,
): Promise<PropertyProfileResult> {
  let homepage: string;
  try {
    const page = await fetchPage(clients, `https://${domain}`, { timeoutMs: 20_000 });
    homepage = page.text.slice(0, 4000);
  } catch (error) {
    if (error instanceof ResearchUnavailableError) {
      throw new PropertyResearchError(error.message);
    }
    throw error;
  }

  const systemPrompt =
    `You are building a prospecting profile for a product called "${name}" (${domain}) ` +
    "from its own homepage content, given below as markdown. Extract only what the " +
    "content actually states or clearly implies — never invent a fact that isn't " +
    'there. Respond with EXACTLY this structure, one line per field, using "unknown" ' +
    'for anything not stated: a first line "SUMMARY: " two to three sentences on what ' +
    'the product does and who it is for; a second line "ICP: " one sentence describing ' +
    'the ideal customer or buyer; a third line "FEATURES: " a comma-separated list of ' +
    '3-6 key features or value props actually mentioned; a fourth line "KEYWORDS: " a ' +
    "comma-separated list of 5-10 terms worth watching for on social listening or job " +
    "postings to find prospects — pain points the product solves, category terms, " +
    "competitor names, or job titles of the likely buyer.";

  const raw = await complete(systemPrompt, { homepage }, { maxTokens: 500, stripMarkdown: false });
  return parsePropertyProfile(raw);
}

export function parsePropertyProfile(raw: string): PropertyProfileResult {
  const field = (label: string): string | null => {
    const match = raw.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
    const value = match?.[1]?.trim();
    return !value || /^unknown$/i.test(value) ? null : value;
  };

  const list = (label: string): string[] => {
    const value = field(label);
    if (!value) return [];
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  };

  return {
    summary: field("SUMMARY"),
    icp: field("ICP"),
    keyFeatures: list("FEATURES"),
    suggestedKeywords: list("KEYWORDS"),
  };
}
