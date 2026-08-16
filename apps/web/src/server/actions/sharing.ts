"use server";

import { revalidatePath } from "next/cache";
import { requireProject } from "@/server/session";
import { getShare, shareProject, unshareProject } from "@/server/sharing";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Share-link mutations.
 *
 * Both resolve the property through `requireProject`, which matches the slug
 * against the caller's own project list — so a link can only ever be minted for
 * a property the caller already owns.
 */

export interface ShareResult extends ActionResult {
  /** Absolute URL, or null once revoked. */
  url: string | null;
}

export async function createShareLink(slug: string): Promise<ShareResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "share", "create a public link");
  if (refusal) return { ...refusal, url: null };

  const token = await shareProject(
    session.workspace.organizationId,
    project.id,
    session.user.id,
    project.name,
  );

  revalidatePath(`/p/${slug}/settings`);
  return { ok: true, message: "Public link created", url: shareUrl(token) };
}

export async function revokeShareLink(slug: string): Promise<ShareResult> {
  const { session, project } = await requireProject(slug);

  const refusal = deny(session.workspace.role, "share", "revoke a public link");
  if (refusal) return { ...refusal, url: null };

  const revoked = await unshareProject(session.workspace.organizationId, project.id);

  revalidatePath(`/p/${slug}/settings`);
  return revoked
    ? { ok: true, message: "Public link revoked", url: null }
    : { ok: false, message: "This property was not shared.", url: null };
}

function shareUrl(token: string): string {
  const origin = process.env.FALORB_APP_URL ?? "http://localhost:3000";
  return `${origin.replace(/\/$/, "")}/share/${token}`;
}
