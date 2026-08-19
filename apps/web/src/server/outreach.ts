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
