import { z } from "zod";
import { and, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { schema } from "@falorb/db";
import { personTimeline } from "@falorb/queries";
import type { AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * The individual humans behind the numbers.
 *
 * This is the toolkit that makes a sales or support agent useful rather than
 * merely analytical: it can go from "signups are up" to "these four people
 * signed up, two of them work at companies we already sell to, here is what
 * they read before converting".
 *
 * Every query is filtered on `organizationId` *and* on the agent's project
 * scope, and soft-deleted people (`deletedAt`) are excluded everywhere. A
 * person erased under GDPR must not reappear because an agent asked nicely.
 */

export const peopleTools: AnyToolDefinition[] = [
  defineTool({
    name: "search_people",
    toolkit: "people",
    description:
      "Find visitors by email, name or identified id. Returns their engagement summary and " +
      "lead score. Use it to look someone up before deciding whether to act on them.",
    input: z.object({
      query: z.string().min(1).describe("Email, name, or identified id — partial matches work."),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Search people for "${a.query}"`,
    execute: async (ctx, a) => {
      const needle = `%${a.query}%`;
      const rows = await ctx.db
        .select({
          personId: schema.persons.id,
          email: schema.persons.email,
          name: schema.persons.name,
          identifiedId: schema.persons.identifiedId,
          leadScore: schema.persons.leadScore,
          totalSessions: schema.persons.totalSessions,
          totalPageviews: schema.persons.totalPageviews,
          totalRevenue: schema.persons.totalRevenue,
          lastSeenAt: schema.persons.lastSeenAt,
          contactedAt: schema.persons.contactedAt,
          projectIds: schema.persons.projectIds,
        })
        .from(schema.persons)
        .where(
          and(
            eq(schema.persons.organizationId, ctx.organizationId),
            isNull(schema.persons.deletedAt),
            sql`${schema.persons.projectIds} && ${sql.raw(`ARRAY[${ctx.projectIds.join(",")}]::integer[]`)}`,
            or(
              ilike(schema.persons.email, needle),
              ilike(schema.persons.name, needle),
              ilike(schema.persons.identifiedId, needle),
            ),
          ),
        )
        .orderBy(desc(schema.persons.lastSeenAt))
        .limit(a.limit);
      return rows;
    },
  }),

  defineTool({
    name: "get_hot_leads",
    toolkit: "people",
    description:
      "The people most worth contacting right now, ranked by lead score. Includes whether " +
      "anyone has already reached out, so you do not queue a second approach to someone a " +
      "colleague contacted yesterday.",
    input: z.object({
      limit: z.number().int().min(1).max(50).default(15),
      minScore: z.number().int().min(0).max(100).default(1),
      onlyUncontacted: z
        .boolean()
        .default(true)
        .describe("Exclude people already marked as contacted. Usually what you want."),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Top ${a.limit} leads`,
    execute: async (ctx, a) => {
      const conditions = [
        eq(schema.persons.organizationId, ctx.organizationId),
        isNull(schema.persons.deletedAt),
        gte(schema.persons.leadScore, a.minScore),
        sql`${schema.persons.projectIds} && ${sql.raw(`ARRAY[${ctx.projectIds.join(",")}]::integer[]`)}`,
      ];
      if (a.onlyUncontacted) conditions.push(isNull(schema.persons.contactedAt));

      return ctx.db
        .select({
          personId: schema.persons.id,
          email: schema.persons.email,
          name: schema.persons.name,
          leadScore: schema.persons.leadScore,
          totalSessions: schema.persons.totalSessions,
          totalRevenue: schema.persons.totalRevenue,
          lastSeenAt: schema.persons.lastSeenAt,
          interestScores: schema.persons.interestScores,
          companyName: schema.companies.name,
          companyDomain: schema.companies.domain,
          companyIndustry: schema.companies.industry,
        })
        .from(schema.persons)
        .leftJoin(schema.companies, eq(schema.persons.companyId, schema.companies.id))
        .where(and(...conditions))
        .orderBy(desc(schema.persons.leadScore), desc(schema.persons.lastSeenAt))
        .limit(a.limit);
    },
  }),

  defineTool({
    name: "get_person",
    toolkit: "people",
    description:
      "One person's full profile and recent activity across every property they have used. " +
      "Read this before drafting anything addressed to them — it is the difference between a " +
      "generic message and one that refers to what they actually did.",
    input: z.object({
      personId: z.string().uuid(),
      events: z.number().int().min(0).max(100).default(30).describe("Recent events to include."),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Profile for person ${a.personId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const [person] = await ctx.db
        .select()
        .from(schema.persons)
        .where(
          and(
            eq(schema.persons.id, a.personId),
            eq(schema.persons.organizationId, ctx.organizationId),
            isNull(schema.persons.deletedAt),
          ),
        )
        .limit(1);
      if (!person) throw new Error("No such person in this workspace.");

      // Scope check is separate from the fetch: a person can exist in the org
      // yet belong entirely to a property this agent was not given.
      const visible = person.projectIds.some((id) => ctx.projectIds.includes(id));
      if (!visible) throw new Error("That person is on a property this agent cannot see.");

      const timeline = a.events
        ? await personTimeline(ctx.clickhouse, {
            personId: a.personId,
            projectIds: ctx.projectIds,
            limit: a.events,
          })
        : [];

      return {
        person: {
          id: person.id,
          email: person.email,
          name: person.name,
          identifiedId: person.identifiedId,
          leadScore: person.leadScore,
          totalSessions: person.totalSessions,
          totalPageviews: person.totalPageviews,
          totalRevenue: person.totalRevenue,
          firstSeenAt: person.firstSeenAt,
          lastSeenAt: person.lastSeenAt,
          firstChannel: person.firstChannel,
          firstSource: person.firstSource,
          lastCountry: person.lastCountry,
          interestScores: person.interestScores,
          traits: person.traits,
          contactedAt: person.contactedAt,
          projectIds: person.projectIds,
        },
        timeline,
      };
    },
  }),
];
