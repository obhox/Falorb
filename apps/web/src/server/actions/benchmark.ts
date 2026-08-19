"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/session";
import { shareOrganization, unshareOrganization } from "@/server/sharing";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Portfolio-wide benchmark-report share mutations.
 *
 * Scoped by `requireSession` rather than `requireProject` — there is no
 * single property here, the link covers the caller's whole organization, so
 * the only tenancy check needed is "does the caller belong to this org",
 * which the session already establishes.
 */

export interface BenchmarkShareResult extends ActionResult {
  /** Absolute URL, or null once revoked. */
  url: string | null;
}

export async function createBenchmarkReport(): Promise<BenchmarkShareResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "share", "create a public benchmark report");
  if (refusal) return { ...refusal, url: null };

  const token = await shareOrganization(
    session.workspace.organizationId,
    session.user.id,
    session.workspace.organizationName,
  );

  revalidatePath("/settings");
  return { ok: true, message: "Benchmark report created", url: benchmarkUrl(token) };
}

export async function revokeBenchmarkReport(): Promise<BenchmarkShareResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "share", "revoke the public benchmark report");
  if (refusal) return { ...refusal, url: null };

  const revoked = await unshareOrganization(session.workspace.organizationId);

  revalidatePath("/settings");
  return revoked
    ? { ok: true, message: "Benchmark report revoked", url: null }
    : { ok: false, message: "The benchmark report was not shared.", url: null };
}

function benchmarkUrl(token: string): string {
  const origin = process.env.FALORB_APP_URL ?? "http://localhost:3000";
  return `${origin.replace(/\/$/, "")}/benchmark/${token}`;
}
