import "server-only";
import { complete } from "@/server/ai";
import { ExaApiError, FirecrawlApiError, scrapeUrl, searchWeb } from "@/server/research";

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
 * fills that gap on demand: Firecrawl scrapes the company's own homepage
 * (the single highest-signal page), Exa searches for supplementary context
 * a homepage alone won't say, and a short OpenRouter call turns both into
 * the few structured fields `companies` has columns for — explicitly told
 * to leave a field blank rather than infer one that isn't actually stated.
 */
export async function researchCompany(name: string, domain: string): Promise<CompanyResearchResult> {
  let homepage: string | null = null;
  try {
    const page = await scrapeUrl(`https://${domain}`, { timeoutMs: 15_000 });
    homepage = page.markdown.slice(0, 3000);
  } catch (error) {
    if (!(error instanceof FirecrawlApiError)) throw error;
    // Not configured, blocked, or timed out — the search context below can still help.
  }

  let searchContext: string | null = null;
  try {
    const results = await searchWeb(`${name} ${domain} company`, {
      numResults: 5,
      textCharLimit: 400,
    });
    if (results.length) {
      searchContext = results
        .map((r) => `- ${r.title ?? r.url} (${r.url})${r.text ? `: ${r.text}` : ""}`)
        .join("\n");
    }
  } catch (error) {
    if (!(error instanceof ExaApiError)) throw error;
  }

  if (!homepage && !searchContext) {
    throw new CompanyResearchError(
      "Web research found nothing — check that EXA_API_KEY and/or FIRECRAWL_API_KEY are configured.",
    );
  }

  const systemPrompt =
    `You are researching a company called "${name}" (${domain}) from real web content given ` +
    "below: its own homepage markdown, and/or web search results about it. Extract only what " +
    "the content actually states — never guess or infer a fact that isn't there. Respond with " +
    'EXACTLY this structure, one line per field, using "unknown" for anything not stated: a ' +
    'first line "INDUSTRY: " a short industry label (e.g. "B2B SaaS", "e-commerce"), a second ' +
    'line "SIZE: " an employee-count range if stated or clearly implied (e.g. "1-10", ' +
    '"51-200"), a third line "LINKEDIN: " the company\'s LinkedIn URL if one appears in the ' +
    'content, a fourth line "SUMMARY: " one sentence on what the company does.';

  const raw = await complete(
    systemPrompt,
    { homepage, searchContext },
    { maxTokens: 300, stripMarkdown: false },
  );

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
