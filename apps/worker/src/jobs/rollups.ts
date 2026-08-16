import { eq } from "drizzle-orm";
import { chDate, schema, type WorkerContext } from "../context";

/**
 * Rollups that a materialized view cannot maintain.
 *
 * Everything expressible as "aggregate this block of rows" is already an MV
 * (daily_stats, daily_paths, sessions, person_daily). What lands here is the
 * work an MV structurally cannot do: an MV only ever sees the single block
 * being inserted, so it can never compare a row to the *previous* row of a
 * session — which is exactly what a path transition is.
 */

const LOOKBACK_DAYS = 3;

/**
 * Rebuild page-to-page transitions for the recent window.
 *
 * Recomputed rather than appended: events arrive slightly out of order, and an
 * append-only transition table would double-count a session that spans a run
 * boundary. Deleting and reinserting a small date range is cheap and always
 * correct.
 */
export async function rebuildPathTransitions(context: WorkerContext): Promise<void> {
  if (!context.projectIds.length) return;

  const now = Date.now();
  const from = chDate(now - LOOKBACK_DAYS * 86_400_000);

  // Lightweight delete, then reinsert. ClickHouse applies this asynchronously,
  // but the ORDER BY key means the replacement rows collapse onto the same
  // parts, so a brief overlap is invisible to the aggregate.
  await context.clickhouse.command({
    query: `DELETE FROM path_transitions WHERE date >= {from:Date} AND has({projectIds:Array(UInt32)}, project_id)`,
    query_params: { from, projectIds: context.projectIds },
  });

  await context.clickhouse.command({
    query: `
      INSERT INTO path_transitions
      SELECT
          project_id,
          toDate(timestamp)              AS date,
          from_path,
          to_path,
          count()                        AS transitions,
          uniqCombined64State(person_id) AS visitors
      FROM (
          SELECT
              project_id,
              timestamp,
              person_id,
              path AS to_path,
              lagInFrame(path) OVER (PARTITION BY session_id ORDER BY timestamp) AS from_path
          FROM events
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND toDate(timestamp) >= {from:Date}
            AND name = '$pageview'
            AND is_bot = 0
      )
      WHERE from_path != '' AND from_path != to_path
      GROUP BY project_id, date, from_path, to_path
    `,
    query_params: { from, projectIds: context.projectIds },
  });
}

/**
 * Refresh the cached size of each saved segment.
 *
 * The people list shows segment counts next to their names; computing them on
 * page load would mean one ClickHouse aggregation per segment per render.
 */
export async function refreshSegmentCounts(context: WorkerContext): Promise<void> {
  const segments = await context.db.select().from(schema.segments);
  if (!segments.length) return;

  for (const segment of segments) {
    try {
      const definition = segment.definition as { filters?: unknown[] } | null;
      if (!definition?.filters?.length) continue;

      const projectIds = segment.projectId ? [segment.projectId] : context.projectIds;
      if (!projectIds.length) continue;

      const { compileFilters } = await import("@falorb/queries");
      const compiled = compileFilters(definition.filters as never, "seg");

      const result = await context.clickhouse.query({
        query: `
          SELECT uniqCombined64(person_id) AS people
          FROM events_v
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND is_bot = 0
            AND ${compiled.sql}
        `,
        query_params: { projectIds, ...compiled.params },
        format: "JSONEachRow",
      });

      const [row] = await result.json<{ people: string | number }>();
      await context.db
        .update(schema.segments)
        .set({ cachedCount: Number(row?.people ?? 0), cachedAt: new Date() })
        .where(eq(schema.segments.id, segment.id));
    } catch (error) {
      // A malformed segment definition should not stop the others refreshing.
      console.error(`[rollups] segment ${segment.id} failed:`, String(error));
    }
  }
}

/**
 * Force a merge of the aggregate tables.
 *
 * AggregatingMergeTree merges in the background on its own schedule; nudging
 * it during a quiet period keeps part counts low and reads predictable on a
 * small server where background pools are deliberately constrained.
 */
export async function optimizeAggregates(context: WorkerContext): Promise<void> {
  const tables = ["sessions", "daily_stats", "daily_paths", "daily_sources", "person_daily"];
  for (const table of tables) {
    try {
      await context.clickhouse.command({ query: `OPTIMIZE TABLE ${table}` });
    } catch (error) {
      console.error(`[rollups] optimize ${table} failed:`, String(error));
    }
  }
}
