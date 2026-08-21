import type { ClickHouseClient } from "@clickhouse/client";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { chDateTime, type Database, schema } from "../context";
import type { Watermarks } from "../scheduler";

/**
 * Turns `$identify` calls into a unified person.
 *
 * The rule, and the reason cross-project identity is defensible here: two
 * identities are only ever merged on a *deterministic* signal — the site told
 * us, via identify(), that both belong to the same logged-in user, or the
 * visitor clicked a decorated link between two of the organization's own
 * domains. Anonymous visitors are never joined across projects. Doing that
 * would require fingerprinting, which this system does not implement.
 *
 * Merges are applied in ClickHouse by writing to `person_overrides`, which the
 * events_v view resolves at read time. A merge is therefore a handful of small
 * inserts rather than a mutation over the person's entire event history.
 */

interface IdentifyEvent {
  project_id: number;
  distinct_id: string;
  identified_id: string;
  ts: string;
  first_seen: string;
}

export interface IdentityResolverDeps {
  db: Database;
  clickhouse: ClickHouseClient;
  watermarks: Watermarks;
  /** project id -> organization id, for scoping a person to a tenant. */
  projectOrgs: Map<number, string>;
  /** Projects whose identity scope is "org" and may unify across the portfolio. */
  orgScopedProjects: Set<number>;
}

const WATERMARK = "identity";
const BATCH = 5000;

export async function resolveIdentities(deps: IdentityResolverDeps): Promise<number> {
  const since = await deps.watermarks.get(WATERMARK, 7 * 86_400_000);
  // Small overlap to tolerate clock jitter between the worker and ClickHouse.
  const from = since - 60_000;
  const to = Date.now();

  // The window is on `ingested_at` (server receive time), not `timestamp`
  // (client event time). The two diverge routinely: the tracker batches events,
  // holds them while a tab is backgrounded, and beacons them on exit — so an
  // event's timestamp can be many minutes older than its arrival. Watermarking
  // on event time would step past those late arrivals and silently never
  // resolve them, which for this job means a signup that never merges.
  const result = await deps.clickhouse.query({
    query: `
      SELECT
          project_id,
          distinct_id,
          props_str['identified_id'] AS identified_id,
          max(timestamp)             AS ts,
          min(timestamp)             AS first_seen
      FROM events
      WHERE name = '$identify'
        AND ingested_at >= {from:DateTime}
        AND ingested_at < {to:DateTime}
        AND props_str['identified_id'] != ''
      GROUP BY project_id, distinct_id, identified_id
      ORDER BY ts ASC
      LIMIT {batch:UInt32}
    `,
    query_params: {
      from: chDateTime(from).slice(0, 19),
      to: chDateTime(to).slice(0, 19),
      batch: BATCH,
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<IdentifyEvent>();

  let merges = 0;
  for (const row of rows) {
    try {
      if (await resolveOne(deps, row)) merges++;
    } catch (error) {
      // One bad identity must not stall the whole sweep; the watermark only
      // advances past rows we have attempted.
      console.error(`[identity] ${row.project_id}/${row.distinct_id} failed:`, String(error));
    }
  }

  merges += await resolveCrossDomainLinks(deps, from, to);

  await deps.watermarks.set(WATERMARK, to);
  if (merges || rows.length) {
    console.log(`[identity] processed ${rows.length} identify events, ${merges} merges`);
  }
  return merges;
}

interface CrossDomainRow {
  project_id: number;
  distinct_id: string;
  source_device: string;
  ts: string;
  first_seen: string;
}

/**
 * Unify a visitor who clicked from one of the organization's domains to
 * another.
 *
 * This is the second — and only other — way identity crosses a project
 * boundary. Ingest has already decoded and freshness-checked the token, so a
 * row reaching here is an assertion that *this browser* navigated from that
 * device id within the last two minutes.
 *
 * Anonymous visitors are still never merged speculatively: the link is only
 * honoured when the source device is already a known alias inside the same
 * organization. A token naming a device we have never seen is discarded rather
 * than used to invent a person.
 */
async function resolveCrossDomainLinks(
  deps: IdentityResolverDeps,
  from: number,
  to: number,
): Promise<number> {
  const result = await deps.clickhouse.query({
    query: `
      SELECT
          project_id,
          distinct_id,
          props_str['xdomain_from'] AS source_device,
          max(timestamp)            AS ts,
          min(timestamp)            AS first_seen
      FROM events
      WHERE ingested_at >= {from:DateTime}
        AND ingested_at < {to:DateTime}
        AND props_str['xdomain_from'] != ''
      GROUP BY project_id, distinct_id, source_device
      LIMIT 2000
    `,
    query_params: {
      from: chDateTime(from).slice(0, 19),
      to: chDateTime(to).slice(0, 19),
    },
    format: "JSONEachRow",
  });

  const rows = await result.json<CrossDomainRow>();
  if (!rows.length) return 0;

  let merged = 0;
  for (const row of rows) {
    try {
      const orgId = deps.projectOrgs.get(row.project_id);
      if (!orgId) continue;

      // Only projects that opted into org-wide identity participate.
      if (!deps.orgScopedProjects.has(row.project_id)) continue;

      // The source device must belong to this organization — otherwise a token
      // from anywhere could attach a stranger to someone's profile.
      let [sourceAlias] = await deps.db
        .select({
          personId: schema.personAliases.personId,
          projectId: schema.personAliases.projectId,
        })
        .from(schema.personAliases)
        .innerJoin(schema.persons, eq(schema.persons.id, schema.personAliases.personId))
        .where(
          and(
            eq(schema.personAliases.distinctId, row.source_device),
            eq(schema.persons.organizationId, orgId),
          ),
        )
        .limit(1);

      // Usually there is no alias yet, and that is the *normal* case rather
      // than an error: the click happens seconds after the visitor was on the
      // source site, so that session is still open and the sessionizer — which
      // only processes closed sessions — has not created the alias. Requiring
      // one would make this feature work solely for visitors who wandered off
      // for half an hour before clicking, which is nearly nobody.
      //
      // The source device's events are definitely in ClickHouse, so the person
      // is recovered from there and registered before linking.
      if (!sourceAlias) {
        sourceAlias = (await adoptSourceDevice(deps, row.source_device, orgId)) ?? undefined;
        if (!sourceAlias) continue;
      }

      if (!deps.orgScopedProjects.has(sourceAlias.projectId)) continue;

      const [destAlias] = await deps.db
        .select()
        .from(schema.personAliases)
        .where(
          and(
            eq(schema.personAliases.projectId, row.project_id),
            eq(schema.personAliases.distinctId, row.distinct_id),
          ),
        )
        .limit(1);

      if (destAlias?.personId === sourceAlias.personId) continue;

      // The source person survives — they have the longer history, since they
      // existed before the click.
      if (destAlias) {
        await mergePersons(deps, sourceAlias.personId, destAlias.personId, true, "cross_domain_link");
      }

      const linkEvent = {
        project_id: row.project_id,
        distinct_id: row.distinct_id,
        identified_id: "",
        ts: row.ts,
        first_seen: row.first_seen,
      };

      await upsertAlias(deps, sourceAlias.personId, linkEvent, "cross_domain_link");
      // Record the newly-reached project on the profile too, otherwise the
      // person shows history on both sites while `project_ids` still claims
      // one — and "which of my products has this person used" answers wrongly.
      await touchPerson(deps, sourceAlias.personId, linkEvent);

      merged++;
    } catch (error) {
      console.error(`[identity] cross-domain link for ${row.distinct_id} failed:`, String(error));
    }
  }

  if (merged) console.log(`[identity] stitched ${merged} cross-domain visit(s)`);
  return merged;
}

async function resolveOne(deps: IdentityResolverDeps, row: IdentifyEvent): Promise<boolean> {
  const orgId = deps.projectOrgs.get(row.project_id);
  if (!orgId) return false;

  const { db } = deps;

  // The person this device is currently attributed to.
  const [deviceAlias] = await db
    .select()
    .from(schema.personAliases)
    .where(
      and(
        eq(schema.personAliases.projectId, row.project_id),
        eq(schema.personAliases.distinctId, row.distinct_id),
      ),
    )
    .limit(1);

  // The person already known under this identified id. Scoped to the org when
  // the project opts into org-wide identity, otherwise to this project alone.
  const orgScoped = deps.orgScopedProjects.has(row.project_id);
  const [identified] = await db
    .select()
    .from(schema.persons)
    .where(
      and(
        eq(schema.persons.organizationId, orgId),
        eq(schema.persons.identifiedId, row.identified_id),
      ),
    )
    .limit(1);

  // Case 1: nothing known yet — promote the device's person, or create one.
  if (!identified) {
    const personId = deviceAlias?.personId ?? (await createPerson(deps, orgId, row));
    await db
      .update(schema.persons)
      .set({
        identifiedId: row.identified_id,
        lastSeenAt: new Date(row.ts),
        updatedAt: new Date(),
        projectIds: sql`array(SELECT DISTINCT unnest(${schema.persons.projectIds} || ${sql`ARRAY[${row.project_id}]::integer[]`}))`,
      })
      .where(eq(schema.persons.id, personId));

    await upsertAlias(deps, personId, row, "identify");
    return false;
  }

  // Case 2: the device already maps to the right person — nothing to merge.
  if (deviceAlias && deviceAlias.personId === identified.id) {
    await touchPerson(deps, identified.id, row);
    return false;
  }

  // Case 3: a genuine merge. The identified person survives; the anonymous
  // one is absorbed, taking its history with it.
  if (deviceAlias) {
    await mergePersons(deps, identified.id, deviceAlias.personId, orgScoped);
  }
  await upsertAlias(deps, identified.id, row, "identify");
  await touchPerson(deps, identified.id, row);
  return Boolean(deviceAlias);
}

async function createPerson(
  deps: IdentityResolverDeps,
  orgId: string,
  row: IdentifyEvent,
): Promise<string> {
  const [created] = await deps.db
    .insert(schema.persons)
    .values({
      organizationId: orgId,
      identifiedId: row.identified_id,
      projectIds: [row.project_id],
      firstSeenAt: new Date(row.first_seen),
      lastSeenAt: new Date(row.ts),
    })
    .returning();
  return created!.id;
}

/**
 * Record that a device belongs to a person, in both stores.
 *
 * Writing the ClickHouse override here — not only on the merge path — is what
 * keeps the two sides consistent. An alias is an assertion that this
 * distinct_id *is* this person; if Postgres records that but ClickHouse does
 * not, the profile page shows a person spanning two products while every
 * event query still reports them as two separate people.
 *
 * Only identify() calls reach this, so the write volume is one row per login,
 * not one per pageview.
 */
async function upsertAlias(
  deps: IdentityResolverDeps,
  personId: string,
  row: IdentifyEvent,
  kind: string,
): Promise<void> {
  await deps.db
    .insert(schema.personAliases)
    .values({
      personId,
      projectId: row.project_id,
      distinctId: row.distinct_id,
      kind,
      firstSeenAt: new Date(row.first_seen),
      lastSeenAt: new Date(row.ts),
    })
    .onConflictDoUpdate({
      target: [schema.personAliases.projectId, schema.personAliases.distinctId],
      set: { personId, lastSeenAt: new Date(row.ts) },
    });

  await deps.clickhouse.insert({
    table: "person_overrides",
    values: [
      {
        project_id: row.project_id,
        distinct_id: row.distinct_id,
        person_id: personId,
        // ReplacingMergeTree keeps the highest version, so a later assertion
        // always wins over an earlier one without needing a delete.
        version: Date.now(),
      },
    ],
    format: "JSONEachRow",
  });
}

async function touchPerson(
  deps: IdentityResolverDeps,
  personId: string,
  row: IdentifyEvent,
): Promise<void> {
  await deps.db
    .update(schema.persons)
    .set({
      lastSeenAt: new Date(row.ts),
      updatedAt: new Date(),
      projectIds: sql`(SELECT array_agg(DISTINCT x) FROM unnest(${schema.persons.projectIds} || ARRAY[${row.project_id}]::integer[]) AS x)`,
    })
    .where(eq(schema.persons.id, personId));
}

/**
 * Absorb `mergedId` into `survivorId`.
 *
 * Order matters. Aliases are repointed first, so that a crash midway leaves
 * the graph pointing at a person that still exists; the losing row is only
 * removed once nothing references it.
 */
async function mergePersons(
  deps: IdentityResolverDeps,
  survivorId: string,
  mergedId: string,
  orgScoped: boolean,
  reason: "identify" | "cross_domain_link" | "manual" = "identify",
): Promise<void> {
  if (survivorId === mergedId) return;
  const { db } = deps;

  const [merged] = await db
    .select()
    .from(schema.persons)
    .where(eq(schema.persons.id, mergedId))
    .limit(1);
  if (!merged) return;

  const aliases = await db
    .select()
    .from(schema.personAliases)
    .where(eq(schema.personAliases.personId, mergedId));

  // A plain JS array/Date interpolated straight into a `sql` template is not
  // reliably bound as `integer[]`/`timestamptz` by this project's postgres.js
  // driver — build the array as an explicit SQL literal and cast the date,
  // the same way every other `unnest(...)` call in this function does
  // (lines ~279, ~380).
  const mergedProjectIds: SQL = sql.join(
    merged.projectIds.map((id) => sql`${id}`),
    sql.raw(", "),
  );

  await db.transaction(async (tx) => {
    await tx
      .update(schema.personAliases)
      .set({ personId: survivorId })
      .where(eq(schema.personAliases.personId, mergedId));

    // Carry over lifetime totals and keep the earliest first-touch, which is
    // the whole point of the merge: the person's history predates their signup.
    await tx
      .update(schema.persons)
      .set({
        firstSeenAt: sql`least(${schema.persons.firstSeenAt}, ${merged.firstSeenAt.toISOString()}::timestamptz)`,
        totalSessions: sql`${schema.persons.totalSessions} + ${merged.totalSessions}`,
        totalEvents: sql`${schema.persons.totalEvents} + ${merged.totalEvents}`,
        totalPageviews: sql`${schema.persons.totalPageviews} + ${merged.totalPageviews}`,
        totalRevenue: sql`${schema.persons.totalRevenue} + ${merged.totalRevenue}`,
        firstChannel: sql`coalesce(${schema.persons.firstChannel}, ${merged.firstChannel})`,
        firstSource: sql`coalesce(${schema.persons.firstSource}, ${merged.firstSource})`,
        firstReferrerHost: sql`coalesce(${schema.persons.firstReferrerHost}, ${merged.firstReferrerHost})`,
        firstUtmCampaign: sql`coalesce(${schema.persons.firstUtmCampaign}, ${merged.firstUtmCampaign})`,
        firstLandingPath: sql`coalesce(${schema.persons.firstLandingPath}, ${merged.firstLandingPath})`,
        firstReferralCode: sql`coalesce(${schema.persons.firstReferralCode}, ${merged.firstReferralCode})`,
        companyId: sql`coalesce(${schema.persons.companyId}, ${merged.companyId})`,
        projectIds: sql`(SELECT array_agg(DISTINCT x) FROM unnest(${schema.persons.projectIds} || ARRAY[${mergedProjectIds}]::integer[]) AS x)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.persons.id, survivorId));

    await tx.insert(schema.personMerges).values({
      organizationId: merged.organizationId,
      survivorId,
      mergedId,
      reason,
      aliasCount: aliases.length,
      // Snapshot enough to reconstruct the absorbed profile if the merge was
      // wrong; without it a bad merge is unrecoverable.
      mergedSnapshot: merged as unknown as Record<string, unknown>,
    });

    await tx.delete(schema.persons).where(eq(schema.persons.id, mergedId));
  });

  // Point every one of the absorbed person's device ids at the survivor. This
  // is what makes their pre-signup history appear on the profile.
  if (aliases.length) {
    await deps.clickhouse.insert({
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

  if (orgScoped && aliases.length > 1) {
    console.log(
      `[identity] merged ${mergedId} into ${survivorId} across ${new Set(aliases.map((a) => a.projectId)).size} projects`,
    );
  }
}

/**
 * Register a device alias seen in ordinary traffic, so that a person exists in
 * Postgres before they ever identify. Called by the sessionizer, which is
 * where new devices are first observed in bulk.
 */
export async function ensurePersons(
  deps: Pick<IdentityResolverDeps, "db" | "projectOrgs">,
  seen: Array<{ projectId: number; distinctId: string; personId: string; at: Date }>,
): Promise<void> {
  if (!seen.length) return;

  const existing = await deps.db
    .select({ distinctId: schema.personAliases.distinctId, projectId: schema.personAliases.projectId })
    .from(schema.personAliases)
    .where(
      inArray(
        schema.personAliases.distinctId,
        seen.map((s) => s.distinctId),
      ),
    );

  const known = new Set(existing.map((e) => `${e.projectId}:${e.distinctId}`));
  const missing = seen.filter((s) => !known.has(`${s.projectId}:${s.distinctId}`));
  if (!missing.length) return;

  for (const person of missing) {
    const orgId = deps.projectOrgs.get(person.projectId);
    if (!orgId) continue;
    await deps.db.transaction(async (tx) => {
      // The id from ingest is deterministic on (project, distinct_id), so
      // reusing it keeps Postgres and ClickHouse aligned without a lookup.
      await tx
        .insert(schema.persons)
        .values({
          id: person.personId,
          organizationId: orgId,
          projectIds: [person.projectId],
          firstSeenAt: person.at,
          lastSeenAt: person.at,
        })
        .onConflictDoNothing();

      await tx
        .insert(schema.personAliases)
        .values({
          personId: person.personId,
          projectId: person.projectId,
          distinctId: person.distinctId,
          kind: "device",
          firstSeenAt: person.at,
          lastSeenAt: person.at,
        })
        .onConflictDoNothing();
    });
  }
}

/**
 * Register a device that ClickHouse knows about but Postgres does not yet.
 *
 * Used by cross-domain stitching, where the source device is typically mid-
 * session and so has no alias. The person id is read back from the event rows
 * rather than re-derived, so the two stores cannot disagree.
 *
 * Returns null when the device belongs to a project outside this organization,
 * which is the check that stops a forged token from reaching another tenant.
 */
async function adoptSourceDevice(
  deps: IdentityResolverDeps,
  distinctId: string,
  organizationId: string,
): Promise<{ personId: string; projectId: number } | null> {
  const result = await deps.clickhouse.query({
    query: `
      SELECT project_id, toString(person_id) AS person_id, min(timestamp) AS first_seen
      FROM events
      WHERE distinct_id = {distinctId:String}
      GROUP BY project_id, person_id
      ORDER BY first_seen ASC
      LIMIT 1
    `,
    query_params: { distinctId },
    format: "JSONEachRow",
  });

  const [row] = await result.json<{
    project_id: number;
    person_id: string;
    first_seen: string;
  }>();
  if (!row) return null;

  // Tenant boundary: the source project must belong to the same organization.
  if (deps.projectOrgs.get(row.project_id) !== organizationId) return null;

  await ensurePersons(deps, [
    {
      projectId: row.project_id,
      distinctId,
      personId: row.person_id,
      at: new Date(row.first_seen),
    },
  ]);

  return { personId: row.person_id, projectId: row.project_id };
}
