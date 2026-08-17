import { eq, sql } from "drizzle-orm";
import { closedSessions, personTotals } from "@falorb/queries";
import { SESSION_TIMEOUT_MS } from "@falorb/core";
import { schema, type WorkerContext } from "../context";
import { ensurePersons } from "./identity-resolver";
import type { Watermarks } from "../scheduler";

/**
 * Rolls finished sessions up into the Postgres person profile.
 *
 * ClickHouse already maintains the session aggregate; what it cannot do is
 * maintain a *mutable* per-person record — lifetime totals, first- and
 * last-touch attribution, most recent device and location. That record is what
 * makes the people list sortable and filterable without touching the event
 * store, so it lives in Postgres and is updated here.
 *
 * A session is considered finished once it has been idle longer than the
 * tracker's own session timeout, so both sides agree on where the boundary is.
 */

const WATERMARK = "sessionizer";

export async function sessionize(
  context: WorkerContext,
  watermarks: Watermarks,
): Promise<number> {
  if (!context.projectIds.length) return 0;

  const now = Date.now();
  const idleSince = now - SESSION_TIMEOUT_MS;
  const lastRun = await watermarks.get(WATERMARK, 2 * 86_400_000);

  /**
   * Start just before the last run, but never reach back more than a day.
   *
   * `Math.max`, not `Math.min`. With `min` this took the *earlier* of the two
   * bounds, which is always the 24-hour floor — so every run re-processed a
   * full day of closed sessions. The profile totals below accumulate with `+`,
   * so each five-minute pass re-added the same sessions: a person with one
   * real session and three events was reported as 31 sessions and 93 events
   * after a few hours, and every lead score saturated at 100.
   *
   * The overlap is deliberate and small — a session that closed just inside
   * the previous boundary would otherwise be skipped entirely.
   */
  const notBefore = Math.max(lastRun - SESSION_TIMEOUT_MS, idleSince - 86_400_000);

  const sessions = await closedSessions(context.clickhouse, {
    projectIds: context.projectIds,
    idleSince,
    notBefore,
    limit: 20000,
  });

  if (!sessions.length) {
    await watermarks.set(WATERMARK, now);
    return 0;
  }

  // Make sure a person row and identity-graph alias exist for every device
  // seen, so the profile update below has something to write to and a later
  // identify() has an alias to merge.
  await ensurePersons(
    context,
    sessions.map((s) => ({
      projectId: s.project_id,
      distinctId: s.distinct_id,
      personId: s.person_id,
      at: new Date(s.started_at),
    })),
  );

  // Collapse to one update per person: a person with several closed sessions
  // in this window should produce one write, not one per session.
  const byPerson = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = byPerson.get(s.person_id);
    if (list) list.push(s);
    else byPerson.set(s.person_id, [s]);
  }

  /**
   * Lifetime totals, recomputed rather than accumulated.
   *
   * One grouped scan for the whole batch, so this is a single extra query per
   * run regardless of how many people it touches.
   */
  const lifetime = new Map<string, { sessions: number; pageviews: number; events: number; revenue: number }>();
  for (const row of await personTotals(context.clickhouse, {
    personIds: [...byPerson.keys()],
    projectIds: context.projectIds,
  })) {
    lifetime.set(row.person_id, {
      sessions: Number(row.sessions),
      pageviews: Number(row.pageviews),
      events: Number(row.events),
      revenue: Number(row.revenue),
    });
  }

  let updated = 0;
  for (const [personId, list] of byPerson) {
    const latest = list.reduce((a, b) => (a.ended_at > b.ended_at ? a : b));
    const earliest = list.reduce((a, b) => (a.started_at < b.started_at ? a : b));

    const batch = list.reduce(
      (acc, s) => {
        acc.sessions += 1;
        acc.pageviews += Number(s.pageviews);
        acc.events += Number(s.events);
        acc.revenue += Number(s.revenue);
        return acc;
      },
      { sessions: 0, pageviews: 0, events: 0, revenue: 0 },
    );

    // ClickHouse is the source of truth; the batch is the fallback for a
    // person whose raw events have already aged out of retention.
    const authoritative = lifetime.get(personId) ?? batch;

    try {
      const result = await context.db
        .update(schema.persons)
        .set({
          lastSeenAt: new Date(latest.ended_at),
          // coalesce keeps first-touch attribution frozen: it is only written
          // if it was never set, so a returning visitor cannot overwrite the
          // campaign that originally acquired them.
          firstChannel: sql`coalesce(${schema.persons.firstChannel}, ${earliest.channel})`,
          firstSource: sql`coalesce(${schema.persons.firstSource}, ${earliest.source})`,
          firstReferrerHost: sql`coalesce(${schema.persons.firstReferrerHost}, ${earliest.referrer_host})`,
          firstUtmCampaign: sql`coalesce(${schema.persons.firstUtmCampaign}, ${earliest.utm_campaign})`,
          firstLandingPath: sql`coalesce(${schema.persons.firstLandingPath}, ${earliest.entry_path})`,
          lastChannel: latest.channel,
          lastSource: latest.source,
          lastCountry: latest.country,
          lastRegion: latest.region,
          lastCity: latest.city,
          lastDeviceType: latest.device_type,
          lastBrowser: latest.browser,
          lastOs: latest.os,
          // Set, not add. `totals` (this batch) is used only where a lifetime
          // figure is unavailable — a person whose events have aged past the
          // retention window still has closed sessions to report.
          totalSessions: authoritative.sessions,
          totalEvents: authoritative.events,
          totalPageviews: authoritative.pageviews,
          totalRevenue: String(authoritative.revenue),
          leadScore: score(authoritative),
          projectIds: sql`(SELECT array_agg(DISTINCT x) FROM unnest(${schema.persons.projectIds} || ARRAY[${latest.project_id}]::integer[]) AS x)`,
          updatedAt: new Date(),
        })
        .where(eq(schema.persons.id, personId));

      if (result) updated++;
    } catch (error) {
      console.error(`[sessionizer] person ${personId} failed:`, String(error));
    }
  }

  // Advance only to the idle boundary. Anything more recent is still an open
  // session and must be reconsidered on the next run.
  await watermarks.set(WATERMARK, idleSince);
  console.log(`[sessionizer] rolled up ${sessions.length} sessions into ${updated} profiles`);
  return sessions.length;
}

/**
 * Engagement score, 0-100.
 *
 * A blunt heuristic on purpose: it exists to make the people list sortable by
 * "who is worth looking at", not to be a calibrated model. Revenue dominates,
 * then repeat visits, then depth.
 */
function score(totals: {
  sessions: number;
  pageviews: number;
  events: number;
  revenue: number;
}): number {
  // A pure function of lifetime totals. It used to add to the stored score on
  // every run, so given enough runs every person reached 100 and the column
  // stopped distinguishing anyone from anyone else.
  return Math.min(
    100,
    Math.min(40, totals.revenue > 0 ? 40 : 0) +
      Math.min(25, totals.sessions * 5) +
      Math.min(20, Math.floor(totals.pageviews * 1.5)) +
      Math.min(15, Math.floor(totals.events / 2)),
  );
}
