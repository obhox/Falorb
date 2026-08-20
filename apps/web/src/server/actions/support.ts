"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { BundAiApiError } from "@falorb/bund-ai-client";
import { requireSession } from "@/server/session";
import { getBundAiClient } from "@/server/integrations";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Resolve a support escalation from Falorb. Manual, per-record — a human
 * looks at one open escalation and marks it resolved, the same act as
 * clicking "resolve" in Bund AI's own dashboard. Bund AI's own
 * `resolveEscalation` (in its `lib/server/escalation/service.ts`) is the
 * single write path on that side; this calls it via the scoped
 * `escalations:write` API, never a raw field patch.
 */
export async function resolveEscalationAction(escalationId: string): Promise<ActionResult> {
  const session = await requireSession();
  const refusal = deny(session.workspace.role, "actOnIntegrations", "resolve a support escalation");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [row] = await db()
    .select()
    .from(schema.supportEscalations)
    .where(
      and(
        eq(schema.supportEscalations.id, escalationId),
        eq(schema.supportEscalations.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, message: "No such escalation." };
  if (row.status === "resolved") return { ok: false, message: "Already resolved." };

  const client = await getBundAiClient(orgId);
  if (!client) {
    return { ok: false, message: "Bund AI isn't connected. Connect it in Settings → Integrations." };
  }

  try {
    const resolved = await client.resolveEscalation(row.bundAiId);

    await db()
      .update(schema.supportEscalations)
      .set({ status: resolved.status, resolvedAt: new Date(resolved.resolvedAt), syncedAt: new Date() })
      .where(eq(schema.supportEscalations.id, row.id));

    audit(db(), {
      organizationId: orgId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.supportEscalationResolved,
      targetType: "support_escalation",
      targetId: row.id,
      metadata: { bundAiId: row.bundAiId },
    });

    revalidatePath("/support");
    return { ok: true, message: "Escalation resolved." };
  } catch (error) {
    const detail = error instanceof BundAiApiError ? error.message : String(error);
    return { ok: false, message: `Bund AI rejected the update: ${detail}` };
  }
}
