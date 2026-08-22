import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@falorb/db";
import { complete } from "@falorb/ai";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * The other half of `get_hot_leads` (`people.ts`): once an agent has ranked
 * who is worth contacting, this is how it looks at one of them closely,
 * marks the outreach state, and drafts the first message — without needing
 * the `crm` toolkit or a Linki connection at all. Every tool here reads or
 * writes Falorb's own `persons` row; nothing leaves the building.
 *
 * A dedicated toolkit rather than folding these into `people`: browsing a
 * profile and acting on it are different grants. A support-lead agent
 * holding `people` to look someone up should not thereby be able to mark
 * them contacted or draft them a sales message — that is an SDR's job, and
 * `leads` is the toolkit that says so.
 */

async function loadLead(ctx: AgentContext, personId: string) {
  const [row] = await ctx.db
    .select({
      person: schema.persons,
      companyName: schema.companies.name,
      companyDomain: schema.companies.domain,
      companyIndustry: schema.companies.industry,
    })
    .from(schema.persons)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.persons.companyId))
    .where(
      and(
        eq(schema.persons.id, personId),
        eq(schema.persons.organizationId, ctx.organizationId),
        isNull(schema.persons.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new Error("No such lead in this workspace.");

  // Scope check is separate from the fetch: a person can exist in the org
  // yet belong entirely to a property this agent was not given.
  const visible = row.person.projectIds.some((id) => ctx.projectIds.includes(id));
  if (!visible) throw new Error("That lead is on a property this agent cannot see.");

  return row;
}

export const leadsTools: AnyToolDefinition[] = [
  defineTool({
    name: "get_lead",
    toolkit: "leads",
    description:
      "One lead's full detail — score, company, engagement, whether anyone has contacted them " +
      "already. Read this before deciding to approach someone, or before drafting anything " +
      "addressed to them. Use get_hot_leads first to find who to look at.",
    input: z.object({ personId: z.string().uuid() }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Read lead ${a.personId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const { person, companyName, companyDomain, companyIndustry } = await loadLead(ctx, a.personId);
      return {
        personId: person.id,
        name: person.name,
        email: person.email,
        identifiedId: person.identifiedId,
        leadScore: person.leadScore,
        totalSessions: person.totalSessions,
        totalPageviews: person.totalPageviews,
        totalRevenue: person.totalRevenue,
        lastSeenAt: person.lastSeenAt,
        companyName,
        companyDomain,
        companyIndustry,
        interestScores: person.interestScores,
        contactedAt: person.contactedAt,
        contactedBy: person.contactedBy,
        projectCount: person.projectIds.length,
      };
    },
  }),

  defineTool({
    name: "mark_lead_contacted",
    toolkit: "leads",
    description:
      "Set or clear the outreach marker on a lead, so nobody else queues a second approach to " +
      "someone already worked. Set it once you have actually reached out, not once you have " +
      "decided to.",
    input: z.object({
      personId: z.string().uuid(),
      contacted: z.boolean().default(true),
    }),
    capability: "manageCrm",
    effect: "internal",
    risk: "low",
    summarize: (a) => (a.contacted ? `Mark lead ${a.personId.slice(0, 8)} contacted` : `Clear contacted on lead ${a.personId.slice(0, 8)}`),
    execute: async (ctx, a) => {
      await loadLead(ctx, a.personId); // existence + scope check

      const [updated] = await ctx.db
        .update(schema.persons)
        .set({
          contactedAt: a.contacted ? new Date() : null,
          contactedBy: null, // the marker is agent-set here, not a specific human's id
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.persons.id, a.personId), eq(schema.persons.organizationId, ctx.organizationId)),
        )
        .returning({ id: schema.persons.id });

      return { ok: Boolean(updated) };
    },
  }),

  defineTool({
    name: "draft_outreach_message",
    toolkit: "leads",
    description:
      "Write a short, personalized first-contact message for one lead, grounded in what they " +
      "actually did on the site — their interests, company, and engagement, never a generic " +
      "template. Returns the draft only; it is not sent anywhere. Attach it to a task or " +
      "propose it for approval.",
    input: z.object({
      personId: z.string().uuid(),
      projectSlug: z.string().optional().describe("Names the sender's product in the draft. Defaults to the first property in scope."),
    }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Draft outreach for lead ${a.personId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const { person, companyName, companyIndustry } = await loadLead(ctx, a.personId);
      const project = a.projectSlug
        ? ctx.projects.find((p) => p.slug.toLowerCase() === a.projectSlug!.toLowerCase())
        : ctx.projects[0];

      const draft = await complete(
        `You are a sales rep at ${project?.name ?? "the company"} drafting a first outreach ` +
          "email/DM to a hot lead based on their observed activity. Write 3-5 short sentences, " +
          "personal and specific — reference their interests, company, or activity rather than " +
          "generic praise. No markdown, no subject line, no greeting placeholder brackets like " +
          "[Name] — just the message body, ready to send.",
        {
          name: person.name ?? person.identifiedId ?? person.email,
          email: person.email,
          company: companyName,
          industry: companyIndustry,
          leadScore: person.leadScore,
          sessions: person.totalSessions,
          pageviews: person.totalPageviews,
          revenue: person.totalRevenue,
          lastSeenAt: person.lastSeenAt,
          interests: person.interestScores,
        },
        { credentials: ctx.credentials },
      );
      return { draft };
    },
  }),
];
