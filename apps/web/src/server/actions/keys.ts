"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, generateApiKey, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Issuing and revoking API keys.
 *
 * A key is what someone hands to an assistant over MCP, so this is the one
 * place the dashboard produces a credential. Two consequences follow:
 *
 *   The plaintext is returned exactly once and never stored — only its hash is,
 *   so nothing here or in the database can show it again.
 *
 *   Keys default to read-only. An assistant reading analytics is the ordinary
 *   case; one that can also create alerts is a deliberate escalation, so `write`
 *   has to be asked for.
 */

export interface IssuedKeyResult extends ActionResult {
  /** Shown once. There is no way to retrieve it later. */
  key?: string;
  prefix?: string;
}

export async function createApiKey(formData: FormData): Promise<IssuedKeyResult> {
  const session = await requireSession();

  // Minting a credential that can read the whole workspace is an admin act,
  // not an ordinary edit.
  const refusal = deny(session.workspace.role, "manageTeam", "issue an API key");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) {
    return { ok: false, message: "Name the key after where it will live — “CI”, “my assistant”." };
  }

  const scopes = formData.get("write") === "on" ? ["read", "write"] : ["read"];

  // Optional single-project restriction, so a key handed to one team cannot
  // read the rest of the portfolio.
  const projectSlug = String(formData.get("project") ?? "").trim();
  let projectId: number | null = null;
  if (projectSlug) {
    const project = session.projects.find((p) => p.slug === projectSlug);
    if (!project) return { ok: false, message: "No such property." };
    projectId = project.id;
  }

  const expiresInDays = Number(formData.get("expires_in_days"));
  const expiresAt =
    Number.isFinite(expiresInDays) && expiresInDays > 0
      ? new Date(Date.now() + Math.min(expiresInDays, 3650) * 86_400_000)
      : null;

  const issued = generateApiKey();

  const [created] = await db()
    .insert(schema.apiKeys)
    .values({
      organizationId: session.workspace.organizationId,
      projectId,
      name,
      keyHash: issued.keyHash,
      keyPrefix: issued.keyPrefix,
      scopes,
      expiresAt,
    })
    .returning();

  // The API audits key issuance; this path did not, which left the *more*
  // commonly used route as the unrecorded one. After a leak the question is
  // always "when was this minted and by whom", and only the trail answers it.
  audit(db(), {
    organizationId: session.workspace.organizationId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.apiKeyCreated,
    targetType: "api_key",
    targetId: created!.id,
    // The plaintext never enters this object; `audit` also redacts key-shaped
    // fields as a second line of defence.
    metadata: { name, scopes, projectId },
  });

  revalidatePath("/settings/mcp");
  return {
    ok: true,
    message: "Key created",
    key: issued.plaintext,
    prefix: issued.keyPrefix,
  };
}

export async function revokeApiKey(keyId: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageTeam", "revoke an API key");
  if (refusal) return refusal;

  // Revoked, not deleted: the row is the record of what existed and when it was
  // last used, which is exactly what is wanted after a key leaks.
  const [revoked] = await db()
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiKeys.id, keyId),
        eq(schema.apiKeys.organizationId, session.workspace.organizationId),
      ),
    )
    .returning();

  if (!revoked) return { ok: false, message: "No such key." };

  audit(db(), {
    organizationId: session.workspace.organizationId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.apiKeyRevoked,
    targetType: "api_key",
    targetId: revoked.id,
    metadata: { name: revoked.name },
  });

  revalidatePath("/settings/mcp");
  return { ok: true, message: "Key revoked" };
}
