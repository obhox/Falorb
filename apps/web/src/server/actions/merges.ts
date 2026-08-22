"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, schema } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listPeople } from "@/server/people";
import { ch } from "@/server/clickhouse";
import { personLabel } from "@/lib/format";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Manual identity merge/unmerge — duplicates `POST /merge` and
 * `POST /unmerge/:mergeId` in `apps/api/src/routes/people.ts`, same
 * reasoning as every other action in this directory (an already-authenticated
 * dashboard session writes directly rather than round-tripping through a
 * bearer-key API). Also reachable via MCP (`merge_people`/`unmerge_people`
 * in `apps/mcp/src/tools/people.ts`, requires the `write` scope) — a wrong
 * merge is reversible via the snapshot below, unlike person erasure or a
 * credential change, so it does not need the local-operator gate those two
 * carry; get it right by resolving both ids through search_people first
 * rather than relying on the reverse.
 *
 * Gated `manageProject` (admin+) on the dashboard — same tier as the GDPR
 * requests above, for the same reason: this rewrites another profile's
 * identity, not an analysis object.
 */

export interface MergeCandidate {
  id: string;
  label: string;
  email: string | null;
}

/** Up to 6 people matching a search term, for picking a merge target. */
export async function searchMergeCandidates(
  personId: string,
  query: string,
): Promise<ActionResult & { candidates: MergeCandidate[] }> {
  const session = await requireSession();
  if (!query.trim()) return { ok: true, candidates: [] };

  const page = await listPeople({
    organizationId: session.workspace.organizationId,
    projectIds: session.projects.map((p) => p.id),
    search: query.trim(),
    limit: 7,
  });

  const candidates = page.people
    .filter((row) => row.person.id !== personId)
    .slice(0, 6)
    .map((row) => ({
      id: row.person.id,
      label: row.person.name ?? row.person.identifiedId ?? personLabel(row.person.id),
      email: row.person.email,
    }));

  return { ok: true, candidates };
}

export async function mergePeople(survivorId: string, mergedId: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "merge two profiles");
  if (refusal) return refusal;

  if (survivorId === mergedId) return { ok: false, message: "Cannot merge a person into themselves." };

  const orgId = session.workspace.organizationId;

  const [survivor] = await db()
    .select()
    .from(schema.persons)
    .where(and(eq(schema.persons.id, survivorId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  const [merged] = await db()
    .select()
    .from(schema.persons)
    .where(and(eq(schema.persons.id, mergedId), eq(schema.persons.organizationId, orgId)))
    .limit(1);
  if (!survivor || !merged) return { ok: false, message: "No such person." };

  const aliases = await db()
    .select()
    .from(schema.personAliases)
    .where(eq(schema.personAliases.personId, mergedId));

  // A plain JS array interpolated into `sql` as a single parameter is not
  // reliably bound as a Postgres integer[] by the driver — every other
  // `unnest(... || ARRAY[...]::integer[])` call in this codebase builds the
  // literal explicitly (see `identity-resolver.ts`/`backfill.ts`), which is
  // what this does for a multi-element array via `sql.join`.
  const mergedProjectIds: SQL = sql.join(
    merged.projectIds.map((id) => sql`${id}`),
    sql.raw(", "),
  );

  await db().transaction(async (tx) => {
    await tx
      .update(schema.personAliases)
      .set({ personId: survivorId })
      .where(eq(schema.personAliases.personId, mergedId));

    await tx
      .update(schema.persons)
      .set({
        // A plain JS `Date` interpolated into `sql` here hits the same
        // driver-serialization issue as the array above — cast explicitly.
        firstSeenAt: sql`least(${schema.persons.firstSeenAt}, ${merged.firstSeenAt.toISOString()}::timestamptz)`,
        totalSessions: sql`${schema.persons.totalSessions} + ${merged.totalSessions}`,
        totalEvents: sql`${schema.persons.totalEvents} + ${merged.totalEvents}`,
        totalPageviews: sql`${schema.persons.totalPageviews} + ${merged.totalPageviews}`,
        totalRevenue: sql`${schema.persons.totalRevenue} + ${merged.totalRevenue}`,
        email: sql`coalesce(${schema.persons.email}, ${merged.email})`,
        name: sql`coalesce(${schema.persons.name}, ${merged.name})`,
        identifiedId: sql`coalesce(${schema.persons.identifiedId}, ${merged.identifiedId})`,
        companyId: sql`coalesce(${schema.persons.companyId}, ${merged.companyId})`,
        projectIds: sql`(SELECT array_agg(DISTINCT x) FROM unnest(${schema.persons.projectIds} || ARRAY[${mergedProjectIds}]::integer[]) AS x)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.persons.id, survivorId));

    // The snapshot is what makes this reversible; without it an incorrect
    // merge would be permanent.
    await tx.insert(schema.personMerges).values({
      organizationId: orgId,
      survivorId,
      mergedId,
      reason: "manual",
      aliasCount: aliases.length,
      mergedSnapshot: merged as unknown as Record<string, unknown>,
    });

    await tx.delete(schema.persons).where(eq(schema.persons.id, mergedId));
  });

  // Re-point the absorbed person's devices so ClickHouse resolves them to
  // the survivor too, otherwise the two stores disagree.
  if (aliases.length) {
    await ch().insert({
      table: "person_overrides",
      values: aliases.map((a) => ({
        project_id: a.projectId,
        distinct_id: a.distinctId,
        person_id: survivorId,
        version: Date.now(),
      })),
      format: "JSONEachRow",
    });
  }

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.personMerged,
    targetType: "person",
    targetId: survivorId,
    metadata: { mergedId, aliasCount: aliases.length },
  });

  revalidatePath(`/people/${survivorId}`);
  return {
    ok: true,
    message: `Merged. History re-attributes within about a minute, once the identity dictionary reloads.`,
  };
}

export async function unmergePeople(mergeId: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageProject", "reverse a merge");
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;

  const [record] = await db()
    .select()
    .from(schema.personMerges)
    .where(and(eq(schema.personMerges.id, mergeId), eq(schema.personMerges.organizationId, orgId)))
    .limit(1);
  if (!record) return { ok: false, message: "No such merge." };
  if (record.revertedAt) return { ok: false, message: "That merge has already been reverted." };

  const snapshot = record.mergedSnapshot as Record<string, unknown>;
  if (!snapshot?.id) return { ok: false, message: "That merge has no snapshot and cannot be reversed." };

  await db().transaction(async (tx) => {
    await tx
      .insert(schema.persons)
      .values({
        id: record.mergedId,
        organizationId: record.organizationId,
        identifiedId: (snapshot.identifiedId as string) ?? null,
        email: (snapshot.email as string) ?? null,
        name: (snapshot.name as string) ?? null,
        projectIds: (snapshot.projectIds as number[]) ?? [],
        firstSeenAt: new Date((snapshot.firstSeenAt as string) ?? Date.now()),
        lastSeenAt: new Date((snapshot.lastSeenAt as string) ?? Date.now()),
      })
      .onConflictDoNothing();

    await tx
      .update(schema.personMerges)
      .set({ revertedAt: new Date() })
      .where(eq(schema.personMerges.id, record.id));
  });

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.personUnmerged,
    targetType: "person",
    targetId: record.mergedId,
    metadata: { mergeId: record.id, survivorId: record.survivorId },
  });

  revalidatePath(`/people/${record.survivorId}`);
  return {
    ok: true,
    message: "Reverted. Device aliases were not moved back automatically.",
  };
}
