import "server-only";
import { complete } from "@/server/ai";
import type { HotLead } from "@/server/sales";

/**
 * A first-touch outreach draft for one hot lead.
 *
 * Same `complete()` building block the four signals use, with its own
 * one-off prompt rather than a `SignalKind` — this produces a message meant
 * to be copied and sent, not a recommendation read on the dashboard, so it
 * doesn't belong in `SYSTEM_PROMPTS` alongside those.
 */
export async function generateOutreachMessage(lead: HotLead, projectName: string): Promise<string> {
  const systemPrompt =
    `You are a sales rep at ${projectName} drafting a first outreach email/DM to a hot ` +
    "lead based on their observed activity. Write 3-5 short sentences, personal and " +
    "specific — reference their interests, company, or activity rather than generic " +
    "praise. No markdown, no subject line, no greeting placeholder brackets like " +
    "[Name] — just the message body, ready to send.";

  return complete(systemPrompt, {
    name: lead.name ?? lead.identifiedId ?? lead.email,
    email: lead.email,
    company: lead.companyName,
    industry: lead.companyIndustry,
    leadScore: lead.leadScore,
    sessions: lead.totalSessions,
    pageviews: lead.totalPageviews,
    revenue: lead.totalRevenue,
    lastSeenAt: lead.lastSeenAt,
    propertiesVisited: lead.projectCount,
    interests: lead.interestScores,
  });
}

export interface ProspectOutreachInput {
  handle: string | null;
  source: string;
  sourceType: string;
  title: string | null;
  excerpt: string;
  matchedKeywords: string[];
  postedAt: string | null;
  contactName: string | null;
  contactTitle: string | null;
  contactCompanyDomain: string | null;
}

/**
 * A first-touch outreach draft for a prospect discovered off-site (a Reddit
 * post today), not an on-site `HotLead`. Deliberately its own prompt rather
 * than a reuse of `generateOutreachMessage`: the narrative frame has to
 * differ — this is cold outreach referencing a specific public post, and the
 * message must not imply an on-site relationship ("saw you evaluating us")
 * that never happened.
 */
export async function generateProspectOutreachMessage(
  prospect: ProspectOutreachInput,
  projectName: string,
  propertySummary: string | null = null,
): Promise<string> {
  const systemPrompt =
    `You are drafting a first cold-outreach message from ${projectName} to someone who ` +
    `posted publicly on ${prospect.source}, matched because it mentioned something relevant ` +
    "to the product. This is cold outreach, not a warm on-site lead — ground the message in " +
    "the specific post (its title/content and the matched keyword), and do not imply any " +
    "prior relationship or that they have visited the product's site. Write 3-5 short " +
    "sentences. Use their name only if one is given, otherwise address them generically. " +
    "No markdown, no subject line, no greeting placeholder brackets like [Name] — just the " +
    "message body, ready to send." +
    (propertySummary ? ` What ${projectName} actually does, to draw on: ${propertySummary}` : "");

  return complete(systemPrompt, {
    handle: prospect.handle,
    source: prospect.source,
    sourceType: prospect.sourceType,
    postTitle: prospect.title,
    postExcerpt: prospect.excerpt,
    matchedKeywords: prospect.matchedKeywords,
    postedAt: prospect.postedAt,
    contactName: prospect.contactName,
    contactTitle: prospect.contactTitle,
    contactCompanyDomain: prospect.contactCompanyDomain,
  });
}
