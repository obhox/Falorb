"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSession } from "@/server/session";
import { clientKey, LIMITS, rateLimiter } from "@/server/rate-limit";
import {
  disableWaitlist,
  enableWaitlist,
  joinWaitlist,
  resolveWaitlistToken,
  waitlistJoinUrl,
} from "@/server/waitlist";
import { deny } from "./guard";
import type { ActionResult } from "./project";

/**
 * Waitlist mutations.
 *
 * `enableProjectWaitlist` / `disableProjectWaitlist` are gated the same as
 * `shareProject` / `unshareProject` — "share" capability, admin and up — since
 * turning the waitlist on hands out a public link the same way sharing does.
 *
 * `submitWaitlistJoin` is deliberately the odd one out: it is called by an
 * anonymous visitor from `/waitlist/[token]`, so there is no session to check.
 * The token itself is the only credential, resolved server-side before any
 * write happens — an unresolvable token fails closed rather than falling
 * back to some default project.
 */

export async function enableProjectWaitlist(
  slug: string,
): Promise<ActionResult & { url: string | null }> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "share", "turn on the waitlist");
  if (refusal) return { ...refusal, url: null };

  const project = session.projects.find((p) => p.slug === slug);
  if (!project) return { ok: false, message: "No such property.", url: null };

  const token = await enableWaitlist(project.id);

  revalidatePath(`/p/${slug}/waitlist`);
  return { ok: true, message: "Waitlist turned on.", url: waitlistJoinUrl(token) };
}

export async function disableProjectWaitlist(slug: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "share", "turn off the waitlist");
  if (refusal) return refusal;

  const project = session.projects.find((p) => p.slug === slug);
  if (!project) return { ok: false, message: "No such property." };

  await disableWaitlist(project.id);

  revalidatePath(`/p/${slug}/waitlist`);
  return { ok: true, message: "Waitlist turned off." };
}

/**
 * Join a waitlist.
 *
 * The one deliberately unauthenticated *write* in the dashboard: the visitor
 * has a token, not a session, which is the whole point of a public signup
 * form. That also makes it the one place someone can add rows to this
 * product's database without an account, so it is rate limited per address —
 * tightly, because nobody signs up five times a minute by accident and the
 * abuse shape here is list stuffing rather than load.
 *
 * The limit lives in the action rather than in middleware because a server
 * action is not addressed by a path: it arrives as a POST to whatever route
 * the form happens to be on, so a path prefix cannot see it.
 */
export async function submitWaitlistJoin(
  token: string,
  email: string,
  name: string | undefined,
  ref: string | undefined,
): Promise<ActionResult & { referralCode?: string; position?: number }> {
  const verdict = await rateLimiter().check(
    "waitlist-join",
    clientKey(await headers()),
    LIMITS.waitlistJoin,
  );
  if (!verdict.allowed) {
    return { ok: false, message: "Too many attempts just now. Try again in a minute." };
  }

  const resolved = await resolveWaitlistToken(String(token ?? "").trim());
  if (!resolved) return { ok: false, message: "This waitlist is not available." };

  const trimmedEmail = String(email ?? "").trim().slice(0, 254);
  const trimmedName = name ? String(name).trim().slice(0, 120) : undefined;
  const trimmedRef = ref ? String(ref).trim().slice(0, 32) : undefined;

  if (!trimmedEmail) {
    return { ok: false, message: "Enter your email address." };
  }

  return joinWaitlist(resolved.projectId, trimmedEmail, trimmedName, trimmedRef);
}
