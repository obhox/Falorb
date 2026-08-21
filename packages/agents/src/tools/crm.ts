import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, schema } from "@falorb/db";
import { LinkiApiError, type LinkiSignalType } from "@falorb/linki-client";
import { getLinkiClient } from "../clients";
import type { AgentContext, AnyToolDefinition } from "../types";
import { defineTool } from "./define";

/**
 * Sales work: read the mirrored CRM, and act on Linki.
 *
 * The reads come from Falorb's own mirror (`packages/db/src/schema/crm.ts`),
 * not from Linki's API — that mirror is refreshed every 15 minutes by
 * `apps/worker/src/jobs/linki-sync.ts`, and reading it means an agent's
 * research pass costs nothing and cannot rate-limit the sync job it depends
 * on. The writes necessarily go to Linki itself, because Linki is the system
 * of record for a contact.
 *
 * Two rules are enforced here rather than left to the model's judgement, for
 * the same reason `apps/web/src/server/actions/crm.ts` enforces them for a
 * human clicking the button:
 *
 *   The suppression list is checked before any signal is pushed. Someone who
 *   has asked not to be contacted has asked everybody, and a plausible chain
 *   of reasoning is not an exception. Putting this in the prompt instead
 *   would make do-not-contact a suggestion.
 *
 *   A contact is never created twice for the same person. Duplicate contacts
 *   are how an outreach sequence becomes two outreach sequences.
 */

async function requireLinki(ctx: AgentContext) {
  const client = await getLinkiClient(ctx.db, ctx.organizationId);
  if (!client) {
    throw new Error(
      "Linki is not connected for this workspace, so this action cannot be taken. " +
        "Create a task for a human to connect it under Settings → Integrations.",
    );
  }
  return client;
}

async function findContactForPerson(ctx: AgentContext, personId: string) {
  const [row] = await ctx.db
    .select()
    .from(schema.crmContacts)
    .where(
      and(
        eq(schema.crmContacts.organizationId, ctx.organizationId),
        eq(schema.crmContacts.personId, personId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function isSuppressed(ctx: AgentContext, email: string | null): Promise<boolean> {
  if (!email) return false;
  const [row] = await ctx.db
    .select({ id: schema.crmSuppressions.id })
    .from(schema.crmSuppressions)
    .where(
      and(
        eq(schema.crmSuppressions.organizationId, ctx.organizationId),
        eq(schema.crmSuppressions.kind, "email"),
        eq(schema.crmSuppressions.value, email),
      ),
    )
    .limit(1);
  return Boolean(row);
}

const SIGNAL_TYPES = [
  "job_change",
  "funding",
  "hiring",
  "technology",
  "product_intent",
  "custom",
] as const;

export const crmTools: AnyToolDefinition[] = [
  defineTool({
    name: "crm_list_contacts",
    toolkit: "crm",
    description:
      "Contacts mirrored from Linki, newest first. Optionally filtered by a name, company or " +
      "email fragment. Read-only view of the CRM as it stood at the last sync.",
    input: z.object({
      search: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: (a) => (a.search ? `CRM contacts matching "${a.search}"` : "Recent CRM contacts"),
    execute: async (ctx, a) => {
      const rows = await ctx.db
        .select()
        .from(schema.crmContacts)
        .where(eq(schema.crmContacts.organizationId, ctx.organizationId))
        .orderBy(desc(schema.crmContacts.linkiCreatedAt))
        .limit(a.search ? 500 : a.limit);

      if (!a.search) return rows;
      const needle = a.search.toLowerCase();
      return rows
        .filter((r) =>
          [r.fullName, r.email, r.company, r.title].some((v) =>
            (v ?? "").toLowerCase().includes(needle),
          ),
        )
        .slice(0, a.limit);
    },
  }),

  defineTool({
    name: "crm_get_pipeline",
    toolkit: "crm",
    description:
      "Open deals by stage, with amounts and owners. The answer to 'what is actually in play " +
      "right now' and 'what is stalling'.",
    input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
    capability: "read",
    effect: "read",
    risk: "low",
    summarize: () => "Read the deal pipeline",
    execute: async (ctx, a) =>
      ctx.db
        .select({
          id: schema.crmDeals.id,
          name: schema.crmDeals.name,
          amount: schema.crmDeals.amount,
          currency: schema.crmDeals.currency,
          stage: schema.crmDealStages.name,
          personId: schema.crmDeals.personId,
          expectedCloseDate: schema.crmDeals.expectedCloseDate,
          notes: schema.crmDeals.notes,
          updatedAt: schema.crmDeals.updatedAt,
        })
        .from(schema.crmDeals)
        .leftJoin(schema.crmDealStages, eq(schema.crmDeals.stageId, schema.crmDealStages.id))
        .where(
          and(
            eq(schema.crmDeals.organizationId, ctx.organizationId),
            isNull(schema.crmDeals.closedAt),
          ),
        )
        .orderBy(desc(schema.crmDeals.updatedAt))
        .limit(a.limit),
  }),

  defineTool({
    name: "crm_create_contact",
    toolkit: "crm",
    description:
      "Create a contact in Linki for a visitor Falorb already knows about, and link the two. " +
      "Requires the person's LinkedIn URL — Linki has no contact without one, so find it " +
      "first or hand the task to a human. Refuses if the person already has a contact.",
    input: z.object({
      personId: z.string().uuid(),
      linkedinUrl: z.string().url().describe("The person's LinkedIn profile URL."),
      fullName: z.string().optional().describe("Overrides the name Falorb already holds."),
      reason: z.string().min(1).describe("Why this person is worth adding to the CRM."),
    }),
    capability: "actOnIntegrations",
    effect: "external",
    risk: "medium",
    summarize: (a) => `Create a Linki contact for person ${a.personId.slice(0, 8)}`,
    execute: async (ctx, a) => {
      const existing = await findContactForPerson(ctx, a.personId);
      if (existing) {
        throw new Error(`Already linked to Linki contact ${existing.linkiId}. Nothing to do.`);
      }

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

      const [company] = person.companyId
        ? await ctx.db
            .select()
            .from(schema.companies)
            .where(eq(schema.companies.id, person.companyId))
            .limit(1)
        : [null];

      const client = await requireLinki(ctx);
      const contact = await client.createContact({
        full_name: a.fullName ?? person.name ?? person.email ?? "Unknown",
        linkedin_url: a.linkedinUrl,
        email: person.email ?? undefined,
        company: company?.name ?? undefined,
        location: person.lastCountry ?? undefined,
      });

      await ctx.db.insert(schema.crmContacts).values({
        organizationId: ctx.organizationId,
        linkiId: contact.id,
        personId: a.personId,
        fullName: contact.full_name,
        email: contact.email,
        company: contact.company,
        location: contact.location,
        linkedinUrl: contact.linkedin_url,
      });

      audit(ctx.db, {
        organizationId: ctx.organizationId,
        actorAgentId: ctx.agent.id,
        action: AUDIT_ACTIONS.crmContactCreated,
        targetType: "person",
        targetId: a.personId,
        metadata: { linkiContactId: contact.id, reason: a.reason, runId: ctx.runId },
      });

      return { linkiContactId: contact.id, fullName: contact.full_name };
    },
  }),

  defineTool({
    name: "crm_push_signal",
    toolkit: "crm",
    description:
      "Tell Linki something changed about a contact — they came back to pricing, their company " +
      "raised, they changed jobs — so Linki's own rules can act on it. The person must already " +
      "be a linked contact. Refuses anyone on the suppression list.",
    input: z.object({
      personId: z.string().uuid(),
      type: z.enum(SIGNAL_TYPES),
      title: z.string().min(1).max(200).describe("One line stating what happened."),
    }),
    capability: "actOnIntegrations",
    effect: "external",
    risk: "medium",
    summarize: (a) => `Push a "${a.type}" signal to Linki: ${a.title}`,
    execute: async (ctx, a) => {
      const contact = await findContactForPerson(ctx, a.personId);
      if (!contact) {
        throw new Error(
          "This person is not linked to a Linki contact yet — create one first, or hand it over.",
        );
      }
      if (await isSuppressed(ctx, contact.email)) {
        throw new Error(
          `${contact.email} is on the suppression list. Do not contact them, and do not look ` +
            "for another route to them.",
        );
      }

      const [person] = await ctx.db
        .select({ leadScore: schema.persons.leadScore })
        .from(schema.persons)
        .where(eq(schema.persons.id, a.personId))
        .limit(1);

      const client = await requireLinki(ctx);
      try {
        const signal = await client.ingestSignal({
          type: a.type as LinkiSignalType,
          title: a.title,
          score: person?.leadScore ?? undefined,
          source: "falorb-agent",
          target_id: contact.linkiId,
        });

        await ctx.db.insert(schema.crmSignalPushes).values({
          organizationId: ctx.organizationId,
          personId: a.personId,
          contactId: contact.id,
          signalType: a.type,
          score: person?.leadScore != null ? String(person.leadScore) : null,
          payload: { title: a.title, target_id: contact.linkiId, agentId: ctx.agent.id },
          status: "sent",
          linkiSignalId: signal.id,
        });

        audit(ctx.db, {
          organizationId: ctx.organizationId,
          actorAgentId: ctx.agent.id,
          action: AUDIT_ACTIONS.crmSignalPushed,
          targetType: "person",
          targetId: a.personId,
          metadata: { type: a.type, linkiSignalId: signal.id, runId: ctx.runId },
        });

        return { linkiSignalId: signal.id };
      } catch (error) {
        const detail = error instanceof LinkiApiError ? error.message : String(error);
        // Record the failure too. A push that Linki rejected is a fact about
        // this person's outreach history, and losing it would let an agent
        // retry the same rejected push every shift forever.
        await ctx.db.insert(schema.crmSignalPushes).values({
          organizationId: ctx.organizationId,
          personId: a.personId,
          contactId: contact.id,
          signalType: a.type,
          payload: { title: a.title, target_id: contact.linkiId, agentId: ctx.agent.id },
          status: "failed",
          error: detail,
        });
        throw new Error(`Linki rejected the push: ${detail}`);
      }
    },
  }),
];
