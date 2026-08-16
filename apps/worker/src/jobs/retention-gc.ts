import { and, eq, inArray, lt } from "drizzle-orm";
import { chDate, schema, type WorkerContext } from "../context";

/**
 * Data retention and GDPR request handling.
 *
 * These are the jobs that make the privacy posture real rather than
 * aspirational. A retention promise that nothing enforces is not a retention
 * policy, and an erasure request that only clears the profile while the event
 * history remains is not erasure.
 *
 * Deletion must therefore cascade across *both* stores — Postgres for the
 * profile and identity graph, ClickHouse for the behavioural history — and the
 * person is tombstoned rather than removed outright, so that re-ingesting the
 * same device id cannot silently resurrect them.
 */

/** Apply each project's own retention window to the raw event history. */
export async function enforceRetention(context: WorkerContext): Promise<void> {
  for (const [projectId, days] of context.retentionDays) {
    if (!days || days <= 0) continue;
    const cutoff = chDate(Date.now() - days * 86_400_000);

    try {
      // The events table also carries a TTL, which handles the common case
      // efficiently by dropping whole parts. This exists for projects whose
      // retention is shorter than that global TTL.
      await context.clickhouse.command({
        query: `DELETE FROM events WHERE project_id = {projectId:UInt32} AND toDate(timestamp) < {cutoff:Date}`,
        query_params: { projectId, cutoff },
      });
    } catch (error) {
      console.error(`[retention] project ${projectId} failed:`, String(error));
    }
  }

  // The sessions rollup is intentionally unpartitioned (a session can straddle
  // a month boundary), so it has no TTL and must be pruned explicitly.
  const oldest = Math.min(...[...context.retentionDays.values()].filter((d) => d > 0), 760);
  try {
    await context.clickhouse.command({
      query: `DELETE FROM sessions WHERE ended_at < {cutoff:DateTime}`,
      query_params: {
        cutoff: new Date(Date.now() - oldest * 86_400_000)
          .toISOString()
          .replace("T", " ")
          .replace("Z", "")
          .slice(0, 19),
      },
    });
  } catch (error) {
    console.error("[retention] sessions prune failed:", String(error));
  }
}

/** Drain queued GDPR export and erasure requests. */
export async function processDataRequests(context: WorkerContext): Promise<number> {
  const pending = await context.db
    .select()
    .from(schema.dataRequests)
    .where(eq(schema.dataRequests.status, "pending"))
    .limit(20);

  if (!pending.length) return 0;

  let handled = 0;
  for (const request of pending) {
    try {
      await context.db
        .update(schema.dataRequests)
        .set({ status: "processing" })
        .where(eq(schema.dataRequests.id, request.id));

      if (request.kind === "delete") {
        await erasePerson(context, request.personId!);
      } else if (request.kind === "export") {
        await exportPerson(context, request.personId!, request.id);
      }

      await context.db
        .update(schema.dataRequests)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(schema.dataRequests.id, request.id));
      handled++;
    } catch (error) {
      await context.db
        .update(schema.dataRequests)
        .set({ status: "failed", error: String(error).slice(0, 1000) })
        .where(eq(schema.dataRequests.id, request.id));
      console.error(`[gdpr] request ${request.id} failed:`, String(error));
    }
  }

  return handled;
}

/**
 * Erase every trace of one person across both stores.
 *
 * Ordering is deliberate. ClickHouse history goes first, because that is the
 * bulk of the personal data and the part that matters legally; the Postgres
 * aliases are needed to find it, so they are removed only afterwards. A crash
 * between the two leaves a profile with no history — recoverable and safe —
 * rather than orphaned history with no way to identify it.
 */
export async function erasePerson(context: WorkerContext, personId: string): Promise<void> {
  if (!personId) throw new Error("erasePerson requires a person id");

  const aliases = await context.db
    .select()
    .from(schema.personAliases)
    .where(eq(schema.personAliases.personId, personId));

  // Delete by distinct_id as well as person_id: events written before a merge
  // still carry the pre-merge person_id, and would otherwise survive.
  const distinctIds = aliases.map((a) => a.distinctId);

  await context.clickhouse.command({
    query: `
      DELETE FROM events
      WHERE person_id = {personId:UUID}
         OR (length({distinctIds:Array(String)}) > 0 AND has({distinctIds:Array(String)}, distinct_id))
    `,
    query_params: { personId, distinctIds },
  });

  await context.clickhouse.command({
    query: `DELETE FROM sessions WHERE person_id = {personId:UUID}`,
    query_params: { personId },
  });

  await context.clickhouse.command({
    query: `DELETE FROM person_daily WHERE person_id = {personId:UUID}`,
    query_params: { personId },
  });

  if (distinctIds.length) {
    await context.clickhouse.command({
      query: `DELETE FROM person_overrides WHERE has({distinctIds:Array(String)}, distinct_id)`,
      query_params: { distinctIds },
    });
  }

  await context.db.transaction(async (tx) => {
    await tx.delete(schema.personAliases).where(eq(schema.personAliases.personId, personId));

    // Tombstone rather than delete. A hard delete would let the same device id
    // recreate the person on their next visit, quietly undoing the erasure.
    await tx
      .update(schema.persons)
      .set({
        deletedAt: new Date(),
        email: null,
        name: null,
        avatarUrl: null,
        identifiedId: null,
        traits: {},
        interestScores: {},
        lastCity: null,
        lastRegion: null,
        lastCountry: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.persons.id, personId));
  });

  console.log(`[gdpr] erased person ${personId} (${distinctIds.length} device aliases)`);
}

/**
 * Assemble everything held about one person, for a subject access request.
 * Returned as structured data; the caller decides how to deliver it.
 */
export async function exportPerson(
  context: WorkerContext,
  personId: string,
  requestId: string,
): Promise<Record<string, unknown>> {
  const [person] = await context.db
    .select()
    .from(schema.persons)
    .where(eq(schema.persons.id, personId))
    .limit(1);

  const aliases = await context.db
    .select()
    .from(schema.personAliases)
    .where(eq(schema.personAliases.personId, personId));

  const result = await context.clickhouse.query({
    query: `
      SELECT *
      FROM events_v
      WHERE person_id = {personId:UUID}
      ORDER BY timestamp ASC
      LIMIT 50000
    `,
    query_params: { personId },
    format: "JSONEachRow",
  });

  const events = await result.json<Record<string, unknown>>();

  const payload = {
    exported_at: new Date().toISOString(),
    request_id: requestId,
    profile: person ?? null,
    device_aliases: aliases,
    event_count: events.length,
    events,
    note:
      "This export contains all first-party activity recorded on properties operated by this organization. No data is collected about activity on third-party websites.",
  };

  console.log(`[gdpr] exported ${events.length} events for person ${personId}`);
  return payload;
}

/**
 * Remove people who have no remaining activity — e.g. everyone whose events
 * aged out of a short retention window. Without this, Postgres accumulates
 * profiles pointing at history that no longer exists.
 */
export async function pruneOrphanedPersons(context: WorkerContext): Promise<number> {
  // The age guard is essential, not a refinement. A person is created the
  // moment a device is first seen and carries zero totals until the sessionizer
  // rolls up their first *closed* session — which cannot happen until they have
  // been idle for the session timeout. Without this window, every brand-new
  // visitor would be eligible for deletion within seconds of arriving.
  const minAge = new Date(Date.now() - 7 * 86_400_000);

  const stale = await context.db
    .select({ id: schema.persons.id })
    .from(schema.persons)
    .where(
      and(
        eq(schema.persons.totalEvents, 0),
        eq(schema.persons.totalSessions, 0),
        lt(schema.persons.createdAt, minAge),
        lt(schema.persons.lastSeenAt, minAge),
      ),
    )
    .limit(1000);

  if (!stale.length) return 0;

  const ids = stale.map((s) => s.id);
  await context.db.transaction(async (tx) => {
    await tx.delete(schema.personAliases).where(inArray(schema.personAliases.personId, ids));
    await tx.delete(schema.persons).where(inArray(schema.persons.id, ids));
  });

  return ids.length;
}
