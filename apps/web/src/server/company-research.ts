import "server-only";
import { complete } from "@/server/ai";
import { fetchPage, ResearchUnavailableError } from "@/server/research";

export class CompanyResearchError extends Error {}

export interface CompanyResearchResult {
  industry: string | null;
  employeeRange: string | null;
  linkedinUrl: string | null;
  summary: string | null;
}

/**
 * Look up a company's real-world profile from the web. The automatic
 * ASN-based enrichment job (`apps/worker/src/jobs/enrichment.ts`) only ever
 * learns a network operator's registered name — it has no way to know what
 * the company actually does, how big it is, or its LinkedIn presence. This
 * fills that gap on demand: `fetchPage` gets the company's own homepage
 * (the single highest-signal page) from whichever provider is configured
 * — Firecrawl's real scrape, falling back to Exa's `/contents` only if
 * Firecrawl itself is unconfigured or errors — and a short OpenRouter call
 * turns that into the few structured fields `companies` has columns for,
 * explicitly told to leave a field blank rather than infer one that isn't
 * actually stated.
 */
export async function researchCompany(name: string, domain: string): Promise<CompanyResearchResult> {
  let homepage: string;
  try {
    const page = await fetchPage(`https://${domain}`, { timeoutMs: 20_000 });
    homepage = page.text.slice(0, 3000);
  } catch (error) {
    if (error instanceof ResearchUnavailableError) {
      throw new CompanyResearchError(
        "Web research is unavailable — configure EXA_API_KEY or FIRECRAWL_API_KEY.",
      );
    }
    throw error;
  }

  const systemPrompt =
    `You are researching a company called "${name}" (${domain}) from its own homepage content, ` +
    "given below as markdown. Extract only what the content actually states — never guess or " +
    'infer a fact that isn\'t there. Respond with EXACTLY this structure, one line per field, ' +
    'using "unknown" for anything not stated: a first line "INDUSTRY: " a short industry label ' +
    '(e.g. "B2B SaaS", "e-commerce"), a second line "SIZE: " an employee-count range if stated ' +
    'or clearly implied (e.g. "1-10", "51-200"), a third line "LINKEDIN: " the company\'s ' +
    'LinkedIn URL if one is linked from the page, a fourth line "SUMMARY: " one sentence on ' +
    "what the company does.";

  const raw = await complete(systemPrompt, { homepage }, { maxTokens: 300, stripMarkdown: false });

  return parseCompanyResearch(raw);
}

function parseCompanyResearch(raw: string): CompanyResearchResult {
  const field = (label: string): string | null => {
    const match = raw.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
    const value = match?.[1]?.trim();
    return !value || /^unknown$/i.test(value) ? null : value;
  };

  return {
    industry: field("INDUSTRY"),
    employeeRange: field("SIZE"),
    linkedinUrl: field("LINKEDIN"),
    summary: field("SUMMARY"),
  };
}
