import { z } from "zod";
import { and, desc, eq, ne, or, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, schema } from "@falorb/db";
import { getBundAiClient } from "../clients";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * Customer support: read the mirrored Bund AI data, and close out an
 * escalation.
 *
 * An escalation is, by definition, a conversation the support AI already
 * decided it could not handle. Letting a second AI silently close it would
 * defeat the escalation's entire purpose — so `support_resolve_escalation`
 * is `external`/`high`, meaning it queues for a human under every autonomy
 * level short of an explicit per-tool waiver. An agent that has genuinely
 * earned that waiver still leaves a resolution note and an audit row naming
 * it as the actor.
 *
 * The reads are what make the agent useful without that waiver: it can
 * triage the queue, spot the three escalations that are all the same broken
 * checkout, and open one task about the actual bug.
 */

async function requireBundAi(ctx: AgentContext) {
  const client = await getBundAiClient(ctx.db, ctx.organizationId);
  if (!client) {
    throw new Error(
      "Bund AI is not connected for this workspace, so this action cannot be taken. " +
        "Create a task for a human to connect it under Settings → Integrations.",
    );
  }
  return client;
}

export const supportTools: AnyToolDefinition[] = [
  defineTool({
    name: "support_list_escalations",
    toolkit: "support",
    description:
      "Conversations the support AI handed to a human, newest first. Open ones by default. " +
      "The queue to triage at the start of a support shift.",
    input: z.object({
      includeResolved: z.boolean().default(false),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => (a.includeResolved ? "All escalations" : "Open escalations"),
    execute: async (ctx, a) => {
      const conditions = [eq(schema.supportEscalations.organizationId, ctx.organizationId)];
      if (!a.includeResolved) {
        conditions.push(
          and(
            isNull(schema.supportEscalations.resolvedAt),
            or(
              isNull(schema.supportEscalations.status),
              ne(schema.supportEscalations.status, "resolved"),
            ),
          )!,
        );
      }
      return ctx.db
        .select()
        .from(schema.supportEscalations)
        .where(and(...conditions))
        .orderBy(desc(schema.supportEscalations.bundAiCreatedAt))
        .limit(a.limit);
    },
  }),

  defineTool({
    name: "support_list_conversations",
    toolkit: "support",
    description:
      "Recent support conversations mirrored from Bund AI. Use this to see what customers are " +
      "actually asking about, and whether one topic is spiking.",
    input: z.object({ limit: z.number().int().min(1).max(50).default(25) }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: () => "Recent support conversations",
    execute: async (ctx, a) =>
      ctx.db
        .select()
        .from(schema.supportConversations)
        .where(eq(schema.supportConversations.organizationId, ctx.organizationId))
        .orderBy(desc(schema.supportConversations.lastActivityAt))
        .limit(a.limit),
  }),

  defineTool({
    name: "support_resolve_escalation",
    toolkit: "support",
    description:
      "Mark an escalation resolved in Bund AI, with a note saying how. Only do this when the " +
      "underlying problem is genuinely handled — an escalation exists because the support AI " +
      "judged it needed a human, so closing one that is still open is worse than leaving it.",
    input: z.object({
      escalationId: z.string().uuid().describe("Falorb's id for the escalation, from support_list_escalations."),
      resolution: z.string().min(10).max(2000).describe("What was done, and why this is settled."),
    }),
    capability: "actOnIntegrations",
    effect: "external",
    risk: "high",
    summarize: (a) => `Resolve escalation ${a.escalationId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const [escalation] = await ctx.db
        .select()
        .from(schema.supportEscalations)
        .where(
          and(
            eq(schema.supportEscalations.id, a.escalationId),
            eq(schema.supportEscalations.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!escalation) throw new Error("No such escalation in this workspace.");
      if (escalation.resolvedAt) throw new Error("That escalation is already resolved.");

      const client = await requireBundAi(ctx);
      // Bund AI's API takes only the transition, not a note (see
      // `resolveEscalation` in `@falorb/bund-ai-client`). The reasoning is
      // still required as an argument and still recorded — on Falorb's side,
      // in the audit row below. Dropping it because the far end has nowhere
      // to put it would mean an agent could close a customer's escalation
      // and leave no statement anywhere of why.
      await client.resolveEscalation(escalation.bundAiId);

      await ctx.db
        .update(schema.supportEscalations)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(schema.supportEscalations.id, a.escalationId));

      audit(ctx.db, {
        organizationId: ctx.organizationId,
        actorAgentId: ctx.agent.id,
        action: AUDIT_ACTIONS.supportEscalationResolved,
        targetType: "support_escalation",
        targetId: a.escalationId,
        metadata: { bundAiId: escalation.bundAiId, resolution: a.resolution, runId: ctx.runId },
      });

      return { resolved: true, bundAiId: escalation.bundAiId };
    },
  }),
];
