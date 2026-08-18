"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { requireProject } from "@/server/session";
import { LINK_DOMAIN_PATTERN } from "@/server/referrals";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Referral link mutations.
 *
 * `code` is a public, owner-chosen slug — not a secret like the dashboard
 * share token — so validation here is about legibility in a URL (lowercase,
 * hyphenated) and uniqueness, not entropy.
 */

const CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function createReferralLink(slug: string, formData: FormData): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "create a referral link");
  if (refusal) return refusal;

  const label = String(formData.get("label") ?? "").trim();
  const rawCode = String(formData.get("code") ?? "").trim().toLowerCase();
  const destinationUrl = String(formData.get("destinationUrl") ?? "").trim();

  if (!label) return { ok: false, message: "Give the link a label — what it's for, not the code." };

  const code = rawCode || slugify(label);
  if (!CODE_PATTERN.test(code)) {
    return {
      ok: false,
      message: "Codes are 3-64 characters, lowercase letters, numbers and hyphens only.",
    };
  }

  if (destinationUrl) {
    try {
      new URL(destinationUrl);
    } catch {
      return { ok: false, message: "Destination must be a full URL, e.g. https://acme.example/launch." };
    }
  }

  try {
    await db().insert(schema.referralLinks).values({
      projectId: project.id,
      code,
      label,
      destinationUrl: destinationUrl || null,
      createdBy: session.user.id,
    });
  } catch (error) {
    // Unique violation on the code — the one failure mode worth naming
    // specifically, since "that did not work" would send someone straight
    // back to retry the exact same taken code.
    if (error instanceof Error && /unique/i.test(error.message)) {
      return { ok: false, message: `"${code}" is already in use — pick another code.` };
    }
    throw error;
  }

  revalidatePath(`/p/${slug}/referrals`);
  return { ok: true, message: "Referral link created" };
}

export async function revokeReferralLink(slug: string, linkId: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "writeAnalysis", "revoke a referral link");
  if (refusal) return refusal;

  const [revoked] = await db()
    .update(schema.referralLinks)
    .set({ revokedAt: new Date() })
    // Scoped by project as well as id, so a link id from another property
    // matches nothing rather than being revoked.
    .where(and(eq(schema.referralLinks.id, linkId), eq(schema.referralLinks.projectId, project.id)))
    .returning();

  if (!revoked) return { ok: false, message: "No such referral link." };

  revalidatePath(`/p/${slug}/referrals`);
  return { ok: true, message: "Referral link revoked" };
}

/**
 * Configure the domain referral links resolve on, in place of the shared
 * Falorb app domain. This only records the owner's intent — it does not
 * touch DNS or provision anything with the hosting platform; the settings
 * capability tier (rather than the lighter `writeAnalysis` the other actions
 * here use) matches that this changes how the property presents itself
 * publicly, the same tier as changing its tracked domains.
 */
export async function setLinkDomain(slug: string, formData: FormData): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "manageProject", "set a branded referral domain");
  if (refusal) return refusal;

  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();
  if (!domain) return { ok: false, message: "Enter a domain, e.g. go.acme.example." };
  if (!LINK_DOMAIN_PATTERN.test(domain)) {
    return { ok: false, message: "That doesn't look like a domain — no scheme, no path, just the host." };
  }

  try {
    await db().update(schema.projects).set({ linkDomain: domain }).where(eq(schema.projects.id, project.id));
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      return { ok: false, message: `"${domain}" is already configured on another property.` };
    }
    throw error;
  }

  revalidatePath(`/p/${slug}/referrals`);
  return { ok: true, message: "Domain saved — add the CNAME shown below to finish." };
}

export async function clearLinkDomain(slug: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "manageProject", "remove the branded referral domain");
  if (refusal) return refusal;

  await db().update(schema.projects).set({ linkDomain: null }).where(eq(schema.projects.id, project.id));

  revalidatePath(`/p/${slug}/referrals`);
  return { ok: true, message: "Branded domain removed — links fall back to the shared domain" };
}
