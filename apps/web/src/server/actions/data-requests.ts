"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Raise a GDPR export or erasure request for a person.
 *
 * Duplicates `POST /requests` in `apps/api/src/routes/people.ts` — same
 * reasoning as every other action in this directory: the dashboard is an
 * already-authenticated browser session, not a bearer key, so it writes
 * directly rather than round-tripping through the API. Deliberately
 * asynchronous on both paths: a worker (`processDataRequests`,
 * `apps/worker/src/jobs/retention-gc.ts`) drains the queue, since erasure
 * spans both Postgres and ClickHouse and must not be attempted inside a
 * request that can time out halfway.
 *
 * Gated `manageProject` (admin+) for both export and erasure — the API route
 * only distinguishes by requiring a human session for erasure specifically
 * (bearer keys can never erase), but the dashboard is always a human session,
 * so the meaningful distinction here is role tier: exporting or erasing
 * someone's full profile is exactly the class of consequential, account-wide
 * action that shouldn't be reachable by every member.
 */
export async function raiseDataRequest(
  personId: string,
  kind: "export" | "delete",
): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(
    session.workspace.role,
    "manageProject",
    kind === "delete" ? "request erasure of a person" : "request an export of a person",
  );
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;

  const [person] = await db()
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(and(eq(schema.persons.id, personId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!person) return { ok: false, message: "No such person." };

  await db()
    .insert(schema.dataRequests)
    .values({
      organizationId: orgId,
      personId,
      kind,
      requestedBy: session.user.id,
    });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: kind === "delete" ? AUDIT_ACTIONS.personErased : AUDIT_ACTIONS.personExported,
    targetType: "person",
    targetId: personId,
  });

  revalidatePath(`/people/${personId}`);
  return {
    ok: true,
    message:
      kind === "delete"
        ? "Erasure queued — removes the profile and event history across both stores, not reversible."
        : "Export queued.",
  };
}
