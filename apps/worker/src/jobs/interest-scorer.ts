import { eq } from "drizzle-orm";
import { chDateTime, schema, type WorkerContext } from "../context";
import type { Watermarks } from "../scheduler";

/**
 * Per-person interest profile, computed from first-party on-site behaviour.
 *
 * What someone reads on your own sites is a legitimate and genuinely useful
 * interest signal — it is the difference between "a visitor from Germany" and
 * "someone who has read four posts about email deliverability and viewed
 * pricing twice".
 *
 * Two properties make the scores useful rather than just counts:
 *
 *   Rarity weighting. A topic every visitor touches (the homepage, say) says
 *   nothing about an individual. Weighting each topic by how *unusual* it is
 *   across the population — the idea behind TF-IDF — makes a niche interest
 *   outrank a popular one.
 *
 *   Time decay. Interest is current, not historical. An exponential half-life
 *   means last week's reading outweighs last quarter's without ever fully
 *   discarding it.
 */

const WATERMARK = "interests";
const HALF_LIFE_DAYS = 30;
const LOOKBACK_DAYS = 120;
const MAX_TOPICS_PER_PERSON = 12;
const BATCH_PEOPLE = 2000;

interface TopicRow {
  person_id: string;
  topic: string;
  events: number;
  last_seen: string;
}

interface TopicPopularity {
  topic: string;
  people: number;
}

export async function scoreInterests(
  context: WorkerContext,
  watermarks: Watermarks,
): Promise<number> {
  if (!context.projectIds.length) return 0;

  const now = Date.now();
  const since = await watermarks.get(WATERMARK, 86_400_000);
  const lookbackFrom = now - LOOKBACK_DAYS * 86_400_000;

  // Only rescore people active since the last run; recomputing every profile
  // every hour would be almost entirely wasted work.
  //
  // Windowed on `ingested_at` rather than `timestamp` — the tracker batches and
  // beacons on exit, so an event's client timestamp can be well behind its
  // arrival, and an event-time watermark would step over late arrivals.
  const activeResult = await context.clickhouse.query({
    query: `
      SELECT DISTINCT toString(person_id) AS person_id
      FROM events_v
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND ingested_at >= {since:DateTime}
        AND is_bot = 0
      LIMIT {batch:UInt32}
    `,
    query_params: {
      projectIds: context.projectIds,
      since: chDateTime(since).slice(0, 19),
      batch: BATCH_PEOPLE,
    },
    format: "JSONEachRow",
  });

  const active = (await activeResult.json<{ person_id: string }>()).map((r) => r.person_id);
  if (!active.length) {
    await watermarks.set(WATERMARK, now);
    return 0;
  }

  const popularity = await topicPopularity(context, lookbackFrom);
  if (!popularity.size) {
    await watermarks.set(WATERMARK, now);
    return 0;
  }

  const totalPeople = Math.max(...popularity.values(), 1);

  const topicsResult = await context.clickhouse.query({
    query: `
      SELECT
          person_id,
          topic,
          count()        AS events,
          max(timestamp) AS last_seen
      FROM (
          SELECT
              toString(person_id) AS person_id,
              timestamp,
              if(
                  props_str['content_tag'] != '',
                  props_str['content_tag'],
                  splitByChar('/', path)[2]
              ) AS topic
          FROM events_v
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND timestamp >= {from:DateTime64(3)}
            AND is_bot = 0
            AND has({people:Array(String)}, toString(person_id))
      )
      WHERE topic != ''
      GROUP BY person_id, topic
    `,
    query_params: {
      projectIds: context.projectIds,
      from: chDateTime(lookbackFrom),
      people: active,
    },
    format: "JSONEachRow",
  });

  const rows = await topicsResult.json<TopicRow>();

  const byPerson = new Map<string, TopicRow[]>();
  for (const row of rows) {
    const list = byPerson.get(row.person_id);
    if (list) list.push(row);
    else byPerson.set(row.person_id, [row]);
  }

  let updated = 0;
  for (const [personId, topics] of byPerson) {
    const scores = computeScores(topics, popularity, totalPeople, now);
    if (!Object.keys(scores).length) continue;
    try {
      await context.db
        .update(schema.persons)
        .set({ interestScores: scores, updatedAt: new Date() })
        .where(eq(schema.persons.id, personId));
      updated++;
    } catch (error) {
      console.error(`[interests] person ${personId} failed:`, String(error));
    }
  }

  await watermarks.set(WATERMARK, now);
  if (updated) console.log(`[interests] scored ${updated} profiles across ${popularity.size} topics`);
  return updated;
}

/** How many distinct people engaged with each topic — the rarity denominator. */
async function topicPopularity(
  context: WorkerContext,
  from: number,
): Promise<Map<string, number>> {
  const result = await context.clickhouse.query({
    query: `
      SELECT topic, uniqCombined64(person_id) AS people
      FROM (
          SELECT
              person_id,
              if(
                  props_str['content_tag'] != '',
                  props_str['content_tag'],
                  splitByChar('/', path)[2]
              ) AS topic
          FROM events_v
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND timestamp >= {from:DateTime64(3)}
            AND is_bot = 0
      )
      WHERE topic != ''
      GROUP BY topic
      ORDER BY people DESC
      LIMIT 2000
    `,
    query_params: { projectIds: context.projectIds, from: chDateTime(from) },
    format: "JSONEachRow",
  });

  const rows = await result.json<TopicPopularity>();
  return new Map(rows.map((r) => [r.topic, Number(r.people)]));
}

/**
 * Combine engagement, rarity and recency into a 0-100 score per topic.
 *
 * Exported for unit testing: the weighting is the substance of this job, and
 * it is far easier to reason about against fixed inputs than against whatever
 * happens to be in the database.
 */
export function computeScores(
  topics: TopicRow[],
  popularity: Map<string, number>,
  totalPeople: number,
  now: number,
): Record<string, number> {
  const raw: Array<{ topic: string; score: number }> = [];

  for (const t of topics) {
    const events = Number(t.events);
    if (!events) continue;

    // Sub-linear in event count: the tenth pageview on a topic says much less
    // than the second.
    const engagement = 1 + Math.log2(events);

    // Rarity, bounded below at 1 so a universal topic contributes without
    // dominating.
    const people = popularity.get(t.topic) ?? 1;
    const rarity = Math.log(1 + totalPeople / Math.max(people, 1)) + 1;

    const ageDays = Math.max(0, (now - Date.parse(t.last_seen)) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);

    raw.push({ topic: t.topic, score: engagement * rarity * recency });
  }

  if (!raw.length) return {};

  // Normalise to 0-100 against this person's own strongest interest, so scores
  // are comparable within a profile regardless of how active the person is.
  raw.sort((a, b) => b.score - a.score);
  const max = raw[0]!.score || 1;

  const out: Record<string, number> = {};
  for (const item of raw.slice(0, MAX_TOPICS_PER_PERSON)) {
    const value = Math.round((item.score / max) * 100);
    if (value > 0) out[item.topic] = value;
  }
  return out;
}
