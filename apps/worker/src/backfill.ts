import { eq, sql } from "drizzle-orm";
import { closedSessions } from "@falorb/queries";
import { createContext, schema, type WorkerContext } from "./context";
import { ensurePersons } from "./jobs/identity-resolver";

/**
 * Rebuild person profiles from historical events.
 *
 * The scheduled jobs are watermark-driven and only ever move forward, which is
 * correct for a live system but means anything that happened before the worker
 * first ran is invisible in the profile tables — the events are in ClickHouse,
 * but nobody has a session count, a first-touch channel, or a lifetime total.
 * That is the state after any import, restore, or first deploy onto existing
 * traffic.
 *
 * This walks the whole history in day-sized chunks and recomputes those
 * profiles. It is idempotent in the sense that it *resets* totals rather than
 * adding to them, so running it twice does not double anyone's session count —
 * which the incremental sessionizer would, since it accumulates.
 *
 *   npx tsx apps/worker/src/backfill.ts              # everything
 *   npx tsx apps/worker/src/backfill.ts --days 90
 *   npx tsx apps/worker/src/backfill.ts --project linkbry
 */

interface Options {
  days: number;
  projectSlug: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    days: Number(get("--days") ?? 760),
    projectSlug: get("--project") ?? null,
    dryRun: argv.includes("--dry-run"),
  };
}

interface Accumulated {
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
  firstSeen: string;
  lastSeen: string;
  first: {
    channel: string;
    source: string;
    referrerHost: string;
    utmCampaign: string;
    landingPath: string;
  };
  last: {
    channel: string;
    source: string;
    country: string;
    region: string;
    city: string;
    deviceType: string;
    browser: string;
    os: string;
    projectId: number;
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const context = await createContext();

  let projectIds = context.projectIds;
  if (options.projectSlug) {
    const [project] = await context.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.slug, options.projectSlug))
      .limit(1);
    if (!project) {
      console.error(`No project "${options.projectSlug}".`);
      process.exit(1);
    }
    projectIds = [project.id];
  }

  if (!projectIds.length) {
    console.error("No active projects.");
    process.exit(1);
  }

  const now = Date.now();
  const start = now - options.days * 86_400_000;

  console.log(
    `\nBackfilling ${projectIds.length} project(s) over ${options.days} days${options.dryRun ? " (dry run)" : ""}\n`,
  );

  // Accumulate across the whole window in memory before writing. Profiles are
  // per-person totals, so a single write at the end is both far fewer queries
  // and the only way to make the run idempotent — a per-chunk increment would
  // double-count if the command were re-run.
  const byPerson = new Map<string, Accumulated>();
  const devices = new Map<string, { projectId: number; distinctId: string; at: Date }>();

  let chunkStart = start;
  let totalSessions = 0;
  const CHUNK_MS = 86_400_000;

  while (chunkStart < now) {
    const chunkEnd = Math.min(chunkStart + CHUNK_MS, now);

    const sessions = await closedSessions(context.clickhouse, {
      projectIds,
      // Everything in the chunk counts as closed; we are looking at history,
      // not waiting for anyone to go idle.
      idleSince: chunkEnd,
      notBefore: chunkStart,
      limit: 20000,
    });

    for (const s of sessions) {
      if (Date.parse(s.started_at) < chunkStart) continue; // already counted in an earlier chunk

      devices.set(`${s.project_id}:${s.distinct_id}`, {
        projectId: s.project_id,
        distinctId: s.distinct_id,
        at: new Date(s.started_at),
      });

      const existing = byPerson.get(s.person_id);
      if (!existing) {
        byPerson.set(s.person_id, {
          sessions: 1,
          pageviews: Number(s.pageviews),
          events: Number(s.events),
          revenue: Number(s.revenue),
          firstSeen: s.started_at,
          lastSeen: s.ended_at,
          first: {
            channel: s.channel,
            source: s.source,
            referrerHost: s.referrer_host,
            utmCampaign: s.utm_campaign,
            landingPath: s.entry_path,
          },
          last: {
            channel: s.channel,
            source: s.source,
            country: s.country,
            region: s.region,
            city: s.city,
            deviceType: s.device_type,
            browser: s.browser,
            os: s.os,
            projectId: s.project_id,
          },
        });
      } else {
        existing.sessions += 1;
        existing.pageviews += Number(s.pageviews);
        existing.events += Number(s.events);
        existing.revenue += Number(s.revenue);

        if (s.started_at < existing.firstSeen) {
          existing.firstSeen = s.started_at;
          existing.first = {
            channel: s.channel,
            source: s.source,
            referrerHost: s.referrer_host,
            utmCampaign: s.utm_campaign,
            landingPath: s.entry_path,
          };
        }
        if (s.ended_at > existing.lastSeen) {
          existing.lastSeen = s.ended_at;
          existing.last = {
            channel: s.channel,
            source: s.source,
            country: s.country,
            region: s.region,
            city: s.city,
            deviceType: s.device_type,
            browser: s.browser,
            os: s.os,
            projectId: s.project_id,
          };
        }
      }
    }

    totalSessions += sessions.length;
    if (sessions.length) {
      process.stdout.write(
        `\r  ${new Date(chunkStart).toISOString().slice(0, 10)}  ${totalSessions} sessions, ${byPerson.size} people`,
      );
    }
    chunkStart = chunkEnd;
  }

  console.log(`\n\nFound ${totalSessions} sessions across ${byPerson.size} people.`);

  if (options.dryRun) {
    console.log("Dry run — nothing written.");
    process.exit(0);
  }

  // Person rows must exist before their profile can be written. The person id
  // is read back from ClickHouse rather than re-derived here, so the two
  // stores cannot disagree if the derivation ever changes.
  await ensureFromSessions(context, devices, byPerson);

  let written = 0;
  for (const [personId, acc] of byPerson) {
    try {
      await context.db
        .update(schema.persons)
        .set({
          firstSeenAt: new Date(acc.firstSeen),
          lastSeenAt: new Date(acc.lastSeen),
          // Assigned, not incremented — that is what makes a re-run safe.
          totalSessions: acc.sessions,
          totalEvents: acc.events,
          totalPageviews: acc.pageviews,
          totalRevenue: String(acc.revenue),
          firstChannel: acc.first.channel,
          firstSource: acc.first.source,
          firstReferrerHost: acc.first.referrerHost,
          firstUtmCampaign: acc.first.utmCampaign,
          firstLandingPath: acc.first.landingPath,
          lastChannel: acc.last.channel,
          lastSource: acc.last.source,
          lastCountry: acc.last.country,
          lastRegion: acc.last.region,
          lastCity: acc.last.city,
          lastDeviceType: acc.last.deviceType,
          lastBrowser: acc.last.browser,
          lastOs: acc.last.os,
          projectIds: sql`(SELECT array_agg(DISTINCT x) FROM unnest(${schema.persons.projectIds} || ARRAY[${acc.last.projectId}]::integer[]) AS x)`,
          updatedAt: new Date(),
        })
        .where(eq(schema.persons.id, personId));
      written++;
    } catch (error) {
      console.error(`  person ${personId.slice(0, 8)} failed:`, String(error));
    }
  }

  console.log(`Wrote ${written} profiles.`);
  console.log(
    "\nThe sessionizer watermark is untouched, so incremental processing resumes from wherever it was.",
  );

  await context.clickhouse.close();
  context.redis.disconnect();
  process.exit(0);
}

/**
 * Create person + alias rows for every device seen, using the deterministic id
 * ingest already assigned so both stores agree.
 */
async function ensureFromSessions(
  context: WorkerContext,
  devices: Map<string, { projectId: number; distinctId: string; at: Date }>,
  byPerson: Map<string, Accumulated>,
): Promise<void> {
  // Recover the person id for each device from the accumulated set by asking
  // ClickHouse, rather than re-deriving it here and risking a mismatch.
  const wanted = [...devices.values()];
  if (!wanted.length) return;

  const CHUNK = 500;
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const slice = wanted.slice(i, i + CHUNK);
    const result = await context.clickhouse.query({
      query: `
        SELECT DISTINCT project_id, distinct_id, toString(person_id) AS person_id
        FROM events
        WHERE has({distinctIds:Array(String)}, distinct_id)
      `,
      query_params: { distinctIds: slice.map((d) => d.distinctId) },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      project_id: number;
      distinct_id: string;
      person_id: string;
    }>();

    await ensurePersons(
      context,
      rows
        .filter((r) => byPerson.has(r.person_id))
        .map((r) => ({
          projectId: r.project_id,
          distinctId: r.distinct_id,
          personId: r.person_id,
          at: devices.get(`${r.project_id}:${r.distinct_id}`)?.at ?? new Date(),
        })),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
