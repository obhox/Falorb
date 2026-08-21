import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { schema } from "@falorb/db";
import type { AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * What the agent still knows next week.
 *
 * Without this an agent re-derives the same conclusions every shift and
 * never accumulates judgement — which is the whole difference between a
 * cron job with a language model attached and an employee. The interesting
 * memories are not facts about the data (those can be re-queried); they are
 * conclusions and corrections: "the pricing page dip in June was a deploy,
 * not demand", "Sam prefers to be asked before anything goes to a customer",
 * "we tried the LinkedIn angle on this segment and it did not land".
 *
 * `remember` is `internal`, not `read`, and that is deliberate even though
 * it writes nothing a customer sees. A memory steers every future run, so an
 * agent that can silently rewrite its own standing beliefs is an agent whose
 * behaviour drifts without anyone approving the drift. Under `assisted` the
 * first few memories get looked at by a human, which is exactly when it
 * matters.
 */

export const memoryTools: AnyToolDefinition[] = [
  defineTool({
    name: "recall",
    toolkit: "memory",
    description:
      "Search your own notes from previous shifts. Your most important memories are already " +
      "in your briefing; use this to look up something more specific.",
    input: z.object({
      query: z.string().min(1).describe("A word or phrase to match against your notes."),
      limit: z.number().int().min(1).max(20).default(8),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => `Recall notes about "${a.query}"`,
    execute: async (ctx, a) => {
      const needle = `%${a.query}%`;
      const rows = await ctx.db
        .select({
          key: schema.agentMemories.key,
          scope: schema.agentMemories.scope,
          content: schema.agentMemories.content,
          importance: schema.agentMemories.importance,
          updatedAt: schema.agentMemories.updatedAt,
        })
        .from(schema.agentMemories)
        .where(
          and(
            eq(schema.agentMemories.agentId, ctx.agent.id),
            or(ilike(schema.agentMemories.key, needle), ilike(schema.agentMemories.content, needle)),
          ),
        )
        .orderBy(desc(schema.agentMemories.importance), desc(schema.agentMemories.updatedAt))
        .limit(a.limit);

      if (rows.length) {
        // Recording use is what lets a future pruning pass distinguish a
        // memory that still earns its place from one written once and never
        // consulted again.
        await ctx.db
          .update(schema.agentMemories)
          .set({ lastUsedAt: new Date() })
          .where(
            and(
              eq(schema.agentMemories.agentId, ctx.agent.id),
              sql`${schema.agentMemories.key} = ANY(${sql.raw(
                `ARRAY[${rows.map((r) => `'${r.key.replace(/'/g, "''")}'`).join(",")}]::text[]`,
              )})`,
            ),
          );
      }
      return rows;
    },
  }),

  defineTool({
    name: "remember",
    toolkit: "memory",
    description:
      "Write down something worth knowing next time. Save conclusions and corrections, not " +
      "numbers you could look up again. Re-using an existing key overwrites that note, which " +
      "is how you correct yourself.",
    input: z.object({
      key: z
        .string()
        .min(2)
        .max(80)
        .describe("Short stable handle, e.g. 'june-pricing-dip-was-a-deploy'."),
      content: z.string().min(5).max(2000),
      scope: z.enum(["fact", "preference", "playbook", "contact", "outcome"]).default("fact"),
      importance: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(3)
        .describe("5 means it belongs in every briefing. Reserve it."),
    }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Remember "${a.key}"`,
    execute: async (ctx, a) => {
      await ctx.db
        .insert(schema.agentMemories)
        .values({
          organizationId: ctx.organizationId,
          agentId: ctx.agent.id,
          key: a.key,
          scope: a.scope,
          content: a.content,
          importance: a.importance,
          sourceRunId: ctx.runId,
        })
        .onConflictDoUpdate({
          target: [schema.agentMemories.agentId, schema.agentMemories.key],
          set: {
            content: a.content,
            scope: a.scope,
            importance: a.importance,
            sourceRunId: ctx.runId,
            updatedAt: new Date(),
          },
        });
      return { ok: true };
    },
  }),

  defineTool({
    name: "forget",
    toolkit: "memory",
    description:
      "Delete a note you now believe is wrong or no longer relevant. Prefer correcting it with " +
      "`remember` under the same key when the subject still matters.",
    input: z.object({ key: z.string().min(1) }),
    capability: "writeAnalysis",
    effect: "internal",
    risk: "low",
    summarize: (a) => `Forget "${a.key}"`,
    execute: async (ctx, a) => {
      const deleted = await ctx.db
        .delete(schema.agentMemories)
        .where(
          and(eq(schema.agentMemories.agentId, ctx.agent.id), eq(schema.agentMemories.key, a.key)),
        )
        .returning({ key: schema.agentMemories.key });
      return { deleted: deleted.length > 0 };
    },
  }),
];
