"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, setActiveWorkspace } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";

/**
 * Switch which workspace the signed-in account is looking at.
 *
 * Two things make this safe, and neither is the UI. The switcher only lists
 * workspaces the caller belongs to, but that list is a convenience: the
 * organization id arrives as a form value, so it is attacker-controlled, and a
 * server action is a public endpoint that anything able to post to its id can
 * invoke. `setActiveWorkspace` therefore re-derives membership from the
 * database before it writes anything, and refuses otherwise. Beyond that,
 * storing the preference grants nothing on its own — `ensureWorkspace`
 * re-validates it against the membership list on every subsequent request, so
 * even a value written by some future bug resolves to a workspace the user is
 * genuinely in.
 *
 * The redirect is not cosmetic. Most of the dashboard lives under
 * `/p/<slug>`, and a slug is unique per organization — so staying put after a
 * switch lands on a project the new workspace does not have, which
 * `requireProject` correctly turns into a 404. Sending people to the root
 * means a switch always arrives somewhere that exists.
 */
export async function switchWorkspace(organizationId: string): Promise<ActionResult> {
  const session = await requireSession();

  if (organizationId === session.workspace.organizationId) {
    return { ok: true, message: "Already here" };
  }

  const switched = await setActiveWorkspace(db(), session.user.id, organizationId);
  if (!switched) {
    return { ok: false, message: "You are not a member of that workspace." };
  }

  // The whole shell is scoped by workspace — nav, project list, live counts —
  // so the layout has to be rebuilt, not just the page.
  revalidatePath("/", "layout");
  redirect("/");
}
