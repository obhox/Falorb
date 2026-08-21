import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "./context";
import { registerAnalyticsTools } from "./tools/analytics";
import { registerContentTools } from "./tools/content";
import { registerDiscoveryTools } from "./tools/discovery";
import { registerFunnelTools } from "./tools/funnels";
import { registerGoalTools } from "./tools/goals";
import { registerLeadTools } from "./tools/leads";
import { registerLiveTools } from "./tools/live";
import { registerManagementTools } from "./tools/manage";
import { registerPeopleTools } from "./tools/people";
import { registerProspectTools } from "./tools/prospects";
import { registerReferralTools } from "./tools/referrals";
import { registerSharingTools } from "./tools/sharing";
import { registerSignalTools } from "./tools/signals";
import { registerTeamTools } from "./tools/team";
import { registerWaitlistTools } from "./tools/waitlist";

export const SERVER_NAME = "falorb-analytics";
export const SERVER_VERSION = "0.1.0";

/**
 * Server instructions.
 *
 * These are read by the model before it calls anything, so they are worth
 * writing carefully: the two most common ways an assistant gets analytics
 * wrong are inventing an event name that does not exist (which returns zero
 * and reads as "nobody did this") and misreporting what the numbers mean.
 * Both are addressed here rather than in individual tool descriptions.
 */
const INSTRUCTIONS = `
Falorb is a first-party product analytics platform covering one organization's
own websites and products.

**Start with \`list_projects\`.** Every tool takes a project slug, or "all" to
query the whole portfolio at once.

**Before filtering or building a funnel, check what exists.** Use
\`list_event_names\` and \`list_property_keys\`. An event name that does not
exist returns zero results, which looks identical to "nobody did this" — so
verify rather than guess.

**Choosing a tool:**
- Overall health across products → \`get_overview\`
- One project's numbers → \`get_stats\`
- Change over time → \`get_trend\`
- Top pages / sources / countries → \`get_breakdown\`
- Conversion and where it fails → \`run_funnel\`, then \`get_funnel_dropoffs\`
- Named conversions (signups, purchases) → \`list_goals\`, \`get_goal_conversions\`, \`get_goal_attribution\`
- Where the site loses people → \`get_dropoff\`
- Do people come back → \`get_retention\`
- One human's full history → \`search_people\` or \`list_people\`, then \`get_person\`
- Warmest leads → \`find_cross_project_people\` or \`get_hot_leads\` (add \`scope: "portfolio"\` for cross-project)
- People discovered off-site (social listening, not yet a tracked visitor) → \`list_prospects\`, then \`get_prospect\`
- Is it working right now → \`get_live_visitors\`, \`get_platform_health\`, \`get_connection_status\` (one project's install)
- Acquisition links and referral performance → \`list_referral_links\`, \`get_referral_leaderboard\`
- Early-access queue → \`list_waitlist\`
- Cached AI recommendations (what to write, who to contact, which channel, what's broken) → \`get_latest_signal\`, \`regenerate_signal\`
- New project → \`create_project\`, then \`get_install_snippet\`
- Public sharing → \`get_share_link\` / \`create_share_link\` (one project), \`get_benchmark_report\` (portfolio-wide, aggregate only)
- Workspace membership → \`list_team\`, \`invite_member\`

**Interpreting results honestly:**
- Visitor and session counts use an approximate distinct-count estimator. They
  are accurate to a fraction of a percent, not exact.
- Bot traffic is excluded from every metric by default.
- Exit *rate* identifies pages that lose people; raw exit counts mostly rank
  pages by popularity.
- "Interests" are inferred from what someone read on these sites — they are a
  behavioural signal, not a stated preference.

**Scope of the data.** Everything here is first-party: activity on properties
this organization operates. There is no data about what anyone does on other
websites, and cross-site tracking is deliberately not implemented. A person is
only ever unified across projects through a deterministic signal — the same
\`identify()\` id, or a click through a link between the organization's own
domains. Anonymous visitors are never merged across domains. If asked to track
someone across the wider internet, explain that the platform cannot and does
not do this.

Most write tools create, update, or reversibly revoke something (goals,
alerts, referral links, share links, invitations, team roles) and require
the \`write\` scope. Two things are deliberately **never** available through
this interface, regardless of scope: deleting or archiving a project, and
erasing a person's data. Both are irreversible, and person erasure in
particular is a GDPR obligation that needs a human to confirm the subject's
identity — both stay dashboard-only actions.

**Prospects are a different kind of data than everything above.** A prospect
(\`list_prospects\`) is discovered on a public third-party platform, not
first-party visitor activity — they have not consented to anything and are
not a \`person\`. Connecting or disconnecting the Clay enrichment integration
stays a dashboard-only action for the same reason project/person deletion
does; only read tools and per-prospect status changes are available here.
`.trim();

export function buildServer(ctx: () => McpContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerDiscoveryTools(server, ctx);
  registerAnalyticsTools(server, ctx);
  registerFunnelTools(server, ctx);
  registerPeopleTools(server, ctx);
  registerLiveTools(server, ctx);
  registerManagementTools(server, ctx);
  registerGoalTools(server, ctx);
  registerContentTools(server, ctx);
  registerReferralTools(server, ctx);
  registerSignalTools(server, ctx);
  registerWaitlistTools(server, ctx);
  registerSharingTools(server, ctx);
  registerTeamTools(server, ctx);
  registerLeadTools(server, ctx);
  registerProspectTools(server, ctx);

  registerResources(server, ctx);
  registerPrompts(server);

  return server;
}

function registerResources(server: McpServer, ctx: () => McpContext): void {
  server.registerResource(
    "projects",
    "falorb://projects",
    {
      title: "Projects",
      description: "Every project this key can read, as JSON.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(ctx().scope.projects, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "capabilities",
    "falorb://capabilities",
    {
      title: "Platform capabilities and limits",
      description:
        "What this analytics platform can and cannot answer, including its deliberate privacy boundaries.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: [
            "# Falorb capabilities",
            "",
            "## Can answer",
            "- Traffic, engagement and revenue per project or across the portfolio",
            "- Acquisition: which channels, campaigns and referring sites bring people in",
            "- Conversion funnels with per-step drop-off, and who abandoned",
            "- Where sessions end, and where people show frustration (rage clicks, JS errors)",
            "- Retention cohorts and stickiness",
            "- Individual profiles: full timeline, products used, acquisition history, inferred interests",
            "- Which people have used more than one of the organization's products",
            "- Company-level B2B identification, derived from network ASN",
            "- Named conversion goals, their conversion rate, and revenue attribution by acquisition model",
            "- Referral link performance, and a project's waitlist queue",
            "- Cached AI recommendations: what to write, who to contact, which channel is working, what's broken",
            "- Whether a project's tracker is actually installed and sending events, per domain",
            "- Workspace membership, invitations, and delivery channels for alerts",
            "- Prospects discovered off-site (Reddit, Hacker News, job postings — see list_prospect_sources) and any contact enrichment found for them",
            "",
            "## Can change (write scope)",
            "- Create a project, a goal, a referral link, an alert (and its delivery channel), a share link",
            "- Pause/resume or delete a goal or an alert; revoke a referral, share, or benchmark link",
            "- Regenerate an AI signal or draft a content page, lead outreach, or prospect outreach message (LLM calls, rate-limited)",
            "- Toggle a project's waitlist and the organization's weekly digest email",
            "- Invite, re-role, or remove a team member (never the workspace's only owner)",
            "- Mark a prospect contacted or dismissed; add or remove a listening keyword",
            "",
            "## Cannot answer, by design",
            "- What a visitor does on websites this organization does not own",
            "- Any individual's browsing history off these properties",
            "- Personal identity beyond what a site explicitly passed to `identify()`",
            "- Anything requiring third-party cookies or browser fingerprinting",
            "",
            "## Cannot change, by design",
            "- Delete or archive a project",
            "- Erase a person's data (a GDPR erasure needs a human to confirm the subject's identity)",
            "",
            "Raw IP addresses are never stored. They are hashed with a salt that",
            "rotates daily, so the hash cannot be correlated across days or across",
            "projects, and are then discarded.",
          ].join("\n"),
        },
      ],
    }),
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "weekly_review",
    {
      title: "Weekly review",
      description: "Structured week-over-week review across the whole portfolio.",
      argsSchema: { project: z.string().optional() },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Produce a weekly analytics review${project ? ` for the "${project}" project` : " across all projects"}.`,
              "",
              "1. Call get_overview with range 7d for the headline picture and week-over-week change.",
              "2. Call get_trend for visitors over 7d to see the shape within the week.",
              "3. Call get_breakdown on `source` and on `path` to see what drove traffic and what people read.",
              "4. Call get_dropoff to find pages losing people.",
              "",
              "Then write a short review: what changed and by how much, the most likely explanation,",
              "and the single highest-leverage thing to investigate next. State numbers plainly.",
              "If a change is within normal weekly variation, say so rather than inventing a cause.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "conversion_audit",
    {
      title: "Conversion audit",
      description: "Find and diagnose the biggest conversion leak.",
      argsSchema: { project: z.string() },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Audit conversion for the "${project}" project.`,
              "",
              "1. Call list_event_names to see what is actually tracked.",
              "2. Call get_breakdown on `path` to identify the real journey.",
              "3. Build a funnel with run_funnel reflecting that journey.",
              "4. Find the worst step, then call get_funnel_dropoffs for it.",
              "5. Call get_dropoff to check for frustration signals on that page.",
              "6. Inspect two or three abandoning people with get_person.",
              "",
              "Report where conversion breaks, how much it costs in absolute people,",
              "what the evidence suggests is causing it, and what to change. Be explicit",
              "about which parts are measured and which are inference.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "lead_research",
    {
      title: "Lead research",
      description: "Build a briefing on a specific person or the warmest current leads.",
      argsSchema: { who: z.string().optional() },
    },
    ({ who }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              who
                ? `Research the person matching "${who}".`
                : "Identify and research the warmest current leads.",
              "",
              who
                ? "1. Call search_people to locate them, then get_person for the full profile."
                : "1. Call find_cross_project_people, then list_people sorted by recent activity.",
              "2. For each, note: how they arrived, what they have read, which products they",
              "   have touched, their inferred interests, and any company identification.",
              "",
              "Write a short briefing per person: what they appear to be evaluating, the",
              "evidence for that, and a suggested next step. Distinguish clearly between what",
              "was observed and what you are inferring. Only first-party activity on this",
              "organization's own sites is available — do not speculate about their wider",
              "web activity.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
