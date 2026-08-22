"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { LinkiApiError, type LinkiSignalType } from "@falorb/linki-client";
import { requireSession } from "@/server/session";
import { getLinkiClient } from "@/server/integrations";
import { ensureDealStages, getCrmProfile as getCrmProfileRow } from "@/server/crm";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Manual, per-person actions against Linki — push a signal, or create/update
 * the linked contact. Deliberately not automated: a human looks at one
 * person and decides to act on them, the same way they would from Linki's
 * own dashboard, just without switching tabs. The bulk, rule-driven
 * signal-push job (Phase L5/L6 in the integration plan) is a separate,
 * far more heavily gated piece of work — this is not it.
 *
 * Every write here re-fetches the contact/connection from Postgres rather
 * than trusting anything the client posted, and checks Linki's own mirrored
 * suppression list before ever pushing a signal — a manual trigger is not an
 * excuse to skip a do-not-contact check a human would otherwise have to
 * remember themselves.
 */

async function findContact(organizationId: string, personId: string) {
  const [row] = await db()
    .select()
    .from(schema.crmContacts)
    .where(
      and(eq(schema.crmContacts.organizationId, organizationId), eq(schema.crmContacts.personId, personId)),
    )
    .limit(1);
  return row ?? null;
}

async function isSuppressed(organizationId: string, email: string | null): Promise<boolean> {
  if (!email) return false;
  const [row] = await db()
    .select({ id: schema.crmSuppressions.id })
    .from(schema.crmSuppressions)
    .where(
      and(
        eq(schema.crmSuppressions.organizationId, organizationId),
        eq(schema.crmSuppressions.kind, "email"),
        eq(schema.crmSuppressions.value, email),
      ),
    )
    .limit(1);
  return Boolean(row);
}

const SIGNAL_TYPES: LinkiSignalType[] = [
  "job_change",
  "funding",
  "hiring",
  "technology",
  "product_intent",
  "custom",
];

export async function pushLinkiSignal(personId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "actOnIntegrations", "push a signal to Linki");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const type = String(formData.get("type") ?? "");
  if (!SIGNAL_TYPES.includes(type as LinkiSignalType)) {
    return { ok: false, message: "Choose a signal type." };
  }
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!title) return { ok: false, message: "A short title is required." };

  const [person] = await db()
    .select()
    .from(schema.persons)
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!person) return { ok: false, message: "No such person." };

  const contact = await findContact(orgId, personId);
  if (!contact) {
    return {
      ok: false,
      message: "This person isn't linked to a Linki contact yet — create one first.",
    };
  }

  if (await isSuppressed(orgId, contact.email)) {
    return { ok: false, message: `${contact.email} is on Linki's suppression list — refusing to push.` };
  }

  const client = await getLinkiClient(orgId);
  if (!client) {
    return { ok: false, message: "Linki isn't connected. Connect it in Settings → Integrations." };
  }

  try {
    const score = person.leadScore ?? undefined;
    const signal = await client.ingestSignal({
      type: type as LinkiSignalType,
      title,
      score,
      source: "falorb",
      target_id: contact.linkiId,
    });

    await db().insert(schema.crmSignalPushes).values({
      organizationId: orgId,
      personId,
      contactId: contact.id,
      signalType: type,
      score: score !== undefined ? String(score) : null,
      payload: { title, target_id: contact.linkiId },
      status: "sent",
      linkiSignalId: signal.id,
    });

    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.crmSignalPushed,
      targetType: "person",
      targetId: personId,
      metadata: { type, linkiContactId: contact.linkiId, linkiSignalId: signal.id },
    });

    revalidatePath(`/people/${personId}`);
    return { ok: true, message: "Signal pushed to Linki." };
  } catch (error) {
    const detail = error instanceof LinkiApiError ? error.message : String(error);
    await db()
      .insert(schema.crmSignalPushes)
      .values({
        organizationId: orgId,
        personId,
        contactId: contact.id,
        signalType: type,
        payload: { title, target_id: contact.linkiId },
        status: "failed",
        error: detail,
      });
    return { ok: false, message: `Linki rejected the push: ${detail}` };
  }
}

export async function createLinkiContact(personId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "actOnIntegrations", "create a Linki contact");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const linkedinUrl = String(formData.get("linkedin_url") ?? "").trim();
  if (!/^https?:\/\/.+/i.test(linkedinUrl)) {
    return { ok: false, message: "A LinkedIn URL is required — Linki has no contact without one." };
  }

  const existing = await findContact(orgId, personId);
  if (existing) return { ok: false, message: "This person is already linked to a Linki contact." };

  const [person] = await db()
    .select()
    .from(schema.persons)
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!person) return { ok: false, message: "No such person." };

  const [company] = person.companyId
    ? await db().select().from(schema.companies).where(eq(schema.companies.id, person.companyId)).limit(1)
    : [null];

  const fullName =
    String(formData.get("full_name") ?? "").trim() || person.name || person.email || "Unknown";

  const client = await getLinkiClient(orgId);
  if (!client) {
    return { ok: false, message: "Linki isn't connected. Connect it in Settings → Integrations." };
  }

  try {
    const contact = await client.createContact({
      full_name: fullName,
      linkedin_url: linkedinUrl,
      email: person.email ?? undefined,
      company: company?.name ?? undefined,
      location: person.lastCountry ?? undefined,
    });

    await db().insert(schema.crmContacts).values({
      organizationId: orgId,
      linkiId: contact.id,
      personId,
      fullName: contact.full_name,
      email: contact.email,
      company: contact.company,
      location: contact.location,
      linkedinUrl: contact.linkedin_url,
      linkiCreatedAt: contact.created_at ? new Date(contact.created_at) : null,
    });

    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.crmContactCreated,
      targetType: "person",
      targetId: personId,
      metadata: { linkiContactId: contact.id },
    });

    revalidatePath(`/people/${personId}`);
    return { ok: true, message: "Contact created in Linki." };
  } catch (error) {
    const detail = error instanceof LinkiApiError ? error.message : String(error);
    return { ok: false, message: `Linki rejected the contact: ${detail}` };
  }
}

export async function updateLinkiContact(personId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "actOnIntegrations", "update a Linki contact");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const contact = await findContact(orgId, personId);
  if (!contact) return { ok: false, message: "No linked Linki contact to update." };

  const [person] = await db()
    .select()
    .from(schema.persons)
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!person) return { ok: false, message: "No such person." };

  const [company] = person.companyId
    ? await db().select().from(schema.companies).where(eq(schema.companies.id, person.companyId)).limit(1)
    : [null];

  // Prefer Falorb's own CRM profile once one exists — edits made here are
  // what should get pushed outward, not the raw analytics fields. Falls
  // back to person/company data for anyone not yet added to the CRM.
  const profile = await getCrmProfileRow(orgId, personId);

  const client = await getLinkiClient(orgId);
  if (!client) {
    return { ok: false, message: "Linki isn't connected. Connect it in Settings → Integrations." };
  }

  try {
    // Linki's PATCH endpoint has no `linkedin_url` field — only its create
    // endpoint does — so it is deliberately not sent here; it would silently
    // no-op.
    const updated = await client.updateContact(contact.linkiId, {
      email: person.email ?? undefined,
      company: company?.name ?? undefined,
      location: person.lastCountry ?? undefined,
      title: profile?.title ?? undefined,
      phone: profile?.phone ?? undefined,
    });

    await db()
      .update(schema.crmContacts)
      .set({
        email: updated.email,
        company: updated.company,
        location: updated.location,
        syncedAt: new Date(),
      })
      .where(eq(schema.crmContacts.id, contact.id));

    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.crmContactUpdated,
      targetType: "person",
      targetId: personId,
      metadata: { linkiContactId: contact.linkiId },
    });

    revalidatePath(`/people/${personId}`);
    return { ok: true, message: "Linki contact updated from Falorb's data." };
  } catch (error) {
    const detail = error instanceof LinkiApiError ? error.message : String(error);
    return { ok: false, message: `Linki rejected the update: ${detail}` };
  }
}

// --- Falorb-owned CRM (Part 1a) ---------------------------------------------

function trimmedOrNull(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value ? value : null;
}

/**
 * Adds a brand-new contact to the CRM by hand — someone with no analytics
 * history to attach to (unlike `addPersonToCrm`, which needs an existing
 * `persons` row) and no existing Linki contact to promote (unlike
 * `promoteLinkiContact`). Creates the `persons` row itself when needed.
 *
 * Email is required, not just accepted, because it is the only key
 * `apps/worker/src/jobs/linki-sync.ts`'s `linkContactsToPersons` backfill
 * matches on — a manually-added contact without one would never pick up a
 * matching Linki contact's sent-email/campaign history were one to sync in
 * later. If a person with this email already exists (from analytics or a
 * prior manual add), this attaches the CRM profile to that person instead of
 * fragmenting the identity graph with a duplicate.
 */
export async function createCrmContact(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageCrm", "add a contact to the CRM");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const email = trimmedOrNull(formData, "email");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "Enter a valid email — it's how this contact will match Linki's synced activity." };
  }
  const name = trimmedOrNull(formData, "name");
  const title = trimmedOrNull(formData, "title");
  const phone = trimmedOrNull(formData, "phone");
  const notes = trimmedOrNull(formData, "notes");
  const status = trimmedOrNull(formData, "status") ?? "lead";

  const [existingPerson] = await db()
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(and(eq(schema.persons.organizationId, orgId), sql`lower(${schema.persons.email}) = lower(${email})`))
    .limit(1);

  if (existingPerson) {
    const existingProfile = await getCrmProfileRow(orgId, existingPerson.id);
    if (existingProfile) return { ok: false, message: `${email} is already in the CRM.` };
  }

  const personId = await db().transaction(async (tx) => {
    let resolvedId = existingPerson?.id ?? null;
    if (!resolvedId) {
      const [person] = await tx
        .insert(schema.persons)
        .values({
          organizationId: orgId,
          name,
          email,
          firstChannel: "crm",
          firstSource: "manual",
          lastChannel: "crm",
          lastSource: "manual",
        })
        .returning({ id: schema.persons.id });
      if (!person) throw new Error("Person insert returned no row.");
      resolvedId = person.id;
    }

    await tx.insert(schema.crmProfiles).values({
      organizationId: orgId,
      personId: resolvedId,
      title,
      phone,
      notes,
      status,
      createdBy: session.user.id,
    });

    return resolvedId;
  });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.crmProfileCreated,
    targetType: "person",
    targetId: personId,
    metadata: { source: "manual", email },
  });

  revalidatePath(`/people/${personId}`);
  revalidatePath("/crm");
  return {
    ok: true,
    message: existingPerson ? "Existing person added to the CRM." : "Contact added to the CRM.",
  };
}

export async function addPersonToCrm(personId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageCrm", "add a person to the CRM");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [person] = await db()
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!person) return { ok: false, message: "No such person." };

  const existing = await getCrmProfileRow(orgId, personId);
  if (existing) return { ok: false, message: "This person is already in the CRM." };

  await db().insert(schema.crmProfiles).values({
    organizationId: orgId,
    personId,
    createdBy: session.user.id,
  });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.crmProfileCreated,
    targetType: "person",
    targetId: personId,
    metadata: {},
  });

  revalidatePath(`/people/${personId}`);
  revalidatePath("/crm");
  return { ok: true, message: "Added to CRM." };
}

/**
 * The "From Linki" tab's entry point for the pre-existing contact backlog —
 * a `crmContacts` row Linki already knows about that nobody has brought into
 * Falorb's own CRM yet. Unlike `addPersonToCrm`, there's no `persons` row to
 * attach to: one is created here, prefilled from the Linki contact, in the
 * same step as the profile — otherwise this would leave an orphaned contact
 * with the CRM boundary crossed for tracking but not for who they are.
 */
export async function promoteLinkiContact(contactId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageCrm", "add a Linki contact to the CRM");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [contact] = await db()
    .select()
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.organizationId, orgId)))
    .limit(1);
  if (!contact) return { ok: false, message: "No such Linki contact." };
  if (contact.personId) return { ok: false, message: "This contact is already in the CRM." };

  const personId = await db().transaction(async (tx) => {
    const [person] = await tx
      .insert(schema.persons)
      .values({
        organizationId: orgId,
        name: contact.fullName,
        email: contact.email,
        firstChannel: "crm",
        firstSource: "linki",
        lastChannel: "crm",
        lastSource: "linki",
      })
      .returning({ id: schema.persons.id });
    if (!person) throw new Error("Person insert returned no row.");

    await tx.update(schema.crmContacts).set({ personId: person.id }).where(eq(schema.crmContacts.id, contactId));

    await tx.insert(schema.crmProfiles).values({
      organizationId: orgId,
      personId: person.id,
      linkedinUrl: contact.linkedinUrl,
      createdBy: session.user.id,
    });

    return person.id;
  });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.crmProfileCreated,
    targetType: "person",
    targetId: personId,
    metadata: { source: "linki", linkiContactId: contact.linkiId },
  });

  revalidatePath("/crm");
  return { ok: true, message: "Added to CRM." };
}

export async function updateCrmProfile(personId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageCrm", "update a CRM profile");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const profile = await getCrmProfileRow(orgId, personId);
  if (!profile) return { ok: false, message: "This person isn't in the CRM yet." };

  // As in `updateDeal`, a field absent from the FormData means "this caller
  // didn't touch it," not "clear it" — the edit dialog doesn't surface
  // notes, and a save from it would otherwise silently wipe them.
  const title = formData.has("title") ? trimmedOrNull(formData, "title") : profile.title;
  const phone = formData.has("phone") ? trimmedOrNull(formData, "phone") : profile.phone;
  const status = formData.has("status") ? (trimmedOrNull(formData, "status") ?? profile.status) : profile.status;
  const ownerId = formData.has("owner_id") ? trimmedOrNull(formData, "owner_id") : profile.ownerId;
  const notes = formData.has("notes") ? trimmedOrNull(formData, "notes") : profile.notes;

  await db()
    .update(schema.crmProfiles)
    .set({ title, phone, status, ownerId, notes, updatedAt: new Date() })
    .where(eq(schema.crmProfiles.id, profile.id));

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.crmProfileUpdated,
    targetType: "person",
    targetId: personId,
    metadata: { status },
  });

  revalidatePath(`/people/${personId}`);
  revalidatePath("/crm");
  return { ok: true, message: "CRM profile updated." };
}

export async function createDeal(personId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageCrm", "create a deal");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const name = trimmedOrNull(formData, "name");
  if (!name) return { ok: false, message: "A deal name is required." };

  const [person] = await db()
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!person) return { ok: false, message: "No such person." };

  const stages = await ensureDealStages(orgId);
  const defaultStage = stages.find((s) => s.position === 0) ?? stages[0] ?? null;
  const amount = trimmedOrNull(formData, "amount");
  const currency = trimmedOrNull(formData, "currency");
  const source = trimmedOrNull(formData, "source");

  const dealId = await db().transaction(async (tx) => {
    const [existingProfile] = await tx
      .select({ id: schema.crmProfiles.id })
      .from(schema.crmProfiles)
      .where(and(eq(schema.crmProfiles.organizationId, orgId), eq(schema.crmProfiles.personId, personId)))
      .limit(1);

    // "No deal without a CRM profile" — enforced here, not in the schema:
    // a deal created straight from a person who isn't in the CRM yet should
    // still leave them with a profile, not a deal orphaned from the contact
    // record. onConflictDoNothing makes this safe if a profile was created
    // concurrently between the check above and here.
    if (!existingProfile) {
      await tx
        .insert(schema.crmProfiles)
        .values({ organizationId: orgId, personId, createdBy: session.user.id })
        .onConflictDoNothing();
    }

    const [deal] = await tx
      .insert(schema.crmDeals)
      .values({
        organizationId: orgId,
        personId,
        stageId: defaultStage?.id ?? null,
        name,
        amount: amount ?? undefined,
        currency,
        source,
        createdBy: session.user.id,
      })
      .returning({ id: schema.crmDeals.id });
    if (!deal) throw new Error("Deal insert returned no row.");

    return deal.id;
  });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.crmDealCreated,
    targetType: "person",
    targetId: personId,
    metadata: { dealId, name },
  });

  revalidatePath(`/people/${personId}`);
  revalidatePath("/crm");
  return { ok: true, message: "Deal created." };
}

export async function updateDeal(dealId: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "manageCrm", "update a deal");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [deal] = await db()
    .select()
    .from(schema.crmDeals)
    .where(and(eq(schema.crmDeals.id, dealId), eq(schema.crmDeals.organizationId, orgId)))
    .limit(1);
  if (!deal) return { ok: false, message: "No such deal." };

  // Each inline control (the stage select, the owner select) posts a
  // FormData with only its own field — everything else must fall back to
  // the deal's current value, not be wiped. Checking `.has()` rather than
  // treating a missing key the same as an explicitly-cleared one is the
  // difference between "the stage select changed the stage" and "the stage
  // select accidentally blanked the amount and currency too."
  const stageId = formData.has("stage_id") ? trimmedOrNull(formData, "stage_id") : deal.stageId;
  const ownerId = formData.has("owner_id") ? trimmedOrNull(formData, "owner_id") : deal.ownerId;
  const name = formData.has("name") ? (trimmedOrNull(formData, "name") ?? deal.name) : deal.name;
  const amount = formData.has("amount") ? trimmedOrNull(formData, "amount") : deal.amount;
  const currency = formData.has("currency") ? trimmedOrNull(formData, "currency") : deal.currency;
  const notes = formData.has("notes") ? trimmedOrNull(formData, "notes") : deal.notes;

  let closedAt = deal.closedAt;
  if (stageId && stageId !== deal.stageId) {
    const [stage] = await db()
      .select({ isWon: schema.crmDealStages.isWon, isLost: schema.crmDealStages.isLost })
      .from(schema.crmDealStages)
      .where(and(eq(schema.crmDealStages.id, stageId), eq(schema.crmDealStages.organizationId, orgId)))
      .limit(1);
    closedAt = stage && (stage.isWon || stage.isLost) ? new Date() : null;
  }

  await db()
    .update(schema.crmDeals)
    .set({
      name,
      stageId,
      ownerId,
      amount,
      currency,
      notes,
      closedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.crmDeals.id, dealId));

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.crmDealUpdated,
    targetType: "person",
    targetId: deal.personId ?? undefined,
    metadata: { dealId, stageId },
  });

  if (deal.personId) revalidatePath(`/people/${deal.personId}`);
  revalidatePath("/crm");
  return { ok: true, message: "Deal updated." };
}
