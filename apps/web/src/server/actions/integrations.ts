"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, encryptSecret, previewSecret, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Connect/disconnect for third-party integrations — Clay only for now.
 *
 * Gated `manageProject` (admin+), stricter than every other prospecting
 * action in this codebase (which use `writeAnalysis`, member+) — deliberately:
 * a Clay API key is the organization's own paid, third-party credential. A
 * member replacing it can run up billable usage on the org's account, and
 * because the value is one-way encrypted and never re-displayed, replacing
 * it silently orphans whatever the previous connection was relying on with
 * no diff visible to anyone else. `manageProject` is already documented as
 * "changes what is collected / what account resources are spent" — a paid
 * external credential is squarely that, not an analysis object like a goal
 * or an alert.
 */

export async function connectClay(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "connect Clay");
  if (refusal) return refusal;

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey || apiKey.length < 8) {
    return { ok: false, message: "That doesn't look like a valid Clay API key." };
  }

  let encrypted: string;
  try {
    encrypted = encryptSecret(apiKey);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not store the key.",
    };
  }

  await db()
    .insert(schema.integrations)
    .values({
      organizationId: session.workspace.organizationId,
      kind: "clay",
      status: "connected",
      encryptedCredential: encrypted,
      credentialPreview: previewSecret(apiKey),
      connectedAt: new Date(),
      connectedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.integrations.organizationId, schema.integrations.kind],
      set: {
        status: "connected",
        encryptedCredential: encrypted,
        credentialPreview: previewSecret(apiKey),
        connectedAt: new Date(),
        connectedBy: session.user.id,
        lastSyncError: null,
        updatedAt: new Date(),
      },
    });

  revalidatePath("/settings");
  return { ok: true, message: "Clay connected" };
}

export async function disconnectClay(): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "disconnect Clay");
  if (refusal) return refusal;

  await db()
    .update(schema.integrations)
    .set({
      status: "disconnected",
      encryptedCredential: null,
      credentialPreview: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.integrations.organizationId, session.workspace.organizationId),
        eq(schema.integrations.kind, "clay"),
      ),
    );

  revalidatePath("/settings");
  return { ok: true, message: "Clay disconnected" };
}
