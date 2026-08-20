"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { LinkiApiError, type LinkiSignalType } from "@falorb/linki-client";
import { requireSession } from "@/server/session";
import { getLinkiClient } from "@/server/integrations";
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

  const client = await getLinkiClient(orgId);
  if (!client) {
    return { ok: false, message: "Linki isn't connected. Connect it in Settings → Integrations." };
  }

  try {
    const updated = await client.updateContact(contact.linkiId, {
      email: person.email ?? undefined,
      company: company?.name ?? undefined,
      location: person.lastCountry ?? undefined,
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

export interface LinkedContactView {
  linkiId: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  syncedAt: string;
}

export async function getLinkedContact(
  organizationId: string,
  personId: string,
): Promise<LinkedContactView | null> {
  const row = await findContact(organizationId, personId);
  if (!row) return null;
  return {
    linkiId: row.linkiId,
    fullName: row.fullName,
    email: row.email,
    company: row.company,
    syncedAt: row.syncedAt.toISOString(),
  };
}

export async function isLinkiConnected(organizationId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.integrationConnections.id })
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        eq(schema.integrationConnections.provider, "linki"),
        eq(schema.integrationConnections.status, "active"),
        isNull(schema.integrationConnections.revokedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
