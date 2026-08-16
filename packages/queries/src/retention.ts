import type { ClickHouseClient } from "@clickhouse/client";
import { chDate, chDateEnd, runQuery, type BuiltQuery, type DateRange } from "./base";

/**
 * Retention cohorts.
 *
 * Reads `person_daily` rather than `events`. Retention compares every cohort
 * against every subsequent period, so computing it from the raw firehose means
 * scanning the entire history once per cell. The daily rollup reduces that to
 * one small row per person per active day.
 */

export type RetentionGranularity = "day" | "week" | "month";

export interface RetentionOptions {
  projectIds: number[];
  range: DateRange;
  granularity?: RetentionGranularity;
  /** Number of periods to follow each cohort for. */
  periods?: number;
}

export interface RetentionRow {
  cohort: string;
  cohortSize: number;
  /** values[n] = people from the cohort still active n periods later. */
  values: number[];
  /** percentages[n] = values[n] / cohortSize * 100. */
  percentages: number[];
}

function bucketExpr(granularity: RetentionGranularity): string {
  switch (granularity) {
    case "week":
      return "toStartOfWeek(date, 1)";
    case "month":
      return "toStartOfMonth(date)";
    default:
      return "date";
  }
}

function diffUnit(granularity: RetentionGranularity): string {
  return granularity === "week" ? "week" : granularity === "month" ? "month" : "day";
}

export function buildRetention(options: RetentionOptions): BuiltQuery {
  const granularity = options.granularity ?? "week";
  const periods = Math.min(Math.max(options.periods ?? 8, 2), 24);
  const bucket = bucketExpr(granularity);

  return {
    sql: `
      WITH activity AS (
          SELECT
              person_id,
              ${bucket} AS period
          FROM person_daily
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND date >= {from:Date}
            AND date <= {to:Date}
          GROUP BY person_id, period
      ),
      first_seen AS (
          SELECT person_id, min(period) AS cohort
          FROM activity
          GROUP BY person_id
      )
      SELECT
          toString(f.cohort)                                          AS cohort,
          dateDiff('${diffUnit(granularity)}', f.cohort, a.period)     AS period_index,
          uniqCombined64(a.person_id)                                 AS people
      FROM activity AS a
      INNER JOIN first_seen AS f ON a.person_id = f.person_id
      WHERE dateDiff('${diffUnit(granularity)}', f.cohort, a.period) BETWEEN 0 AND {periods:UInt8}
      GROUP BY cohort, period_index
      ORDER BY cohort, period_index
    `,
    params: {
      projectIds: options.projectIds,
      from: chDate(options.range.from),
      to: chDateEnd(options.range.to),
      periods,
    },
  };
}

export async function retention(
  client: ClickHouseClient,
  options: RetentionOptions,
): Promise<RetentionRow[]> {
  const rows = await runQuery<{
    cohort: string;
    period_index: number;
    people: string | number;
  }>(client, buildRetention(options));

  const periods = Math.min(Math.max(options.periods ?? 8, 2), 24);
  const byCohort = new Map<string, number[]>();

  for (const row of rows) {
    let values = byCohort.get(row.cohort);
    if (!values) {
      values = new Array<number>(periods + 1).fill(0);
      byCohort.set(row.cohort, values);
    }
    const index = Number(row.period_index);
    if (index >= 0 && index <= periods) values[index] = Number(row.people);
  }

  return [...byCohort.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, values]) => {
      const size = values[0] ?? 0;
      return {
        cohort,
        cohortSize: size,
        values,
        percentages: values.map((v) => (size ? Math.round((v / size) * 1000) / 10 : 0)),
      };
    });
}

/**
 * Stickiness: how many distinct days a person was active in the window.
 * Answers "is this a daily habit or a monthly visit" in a way retention alone
 * does not.
 */
export function buildStickiness(options: RetentionOptions): BuiltQuery {
  return {
    sql: `
      SELECT
          active_days,
          count() AS people
      FROM (
          SELECT person_id, uniqExact(date) AS active_days
          FROM person_daily
          WHERE has({projectIds:Array(UInt32)}, project_id)
            AND date >= {from:Date}
            AND date <= {to:Date}
          GROUP BY person_id
      )
      GROUP BY active_days
      ORDER BY active_days
    `,
    params: {
      projectIds: options.projectIds,
      from: chDate(options.range.from),
      to: chDateEnd(options.range.to),
    },
  };
}

export function stickiness(
  client: ClickHouseClient,
  options: RetentionOptions,
): Promise<Array<{ active_days: number; people: number }>> {
  return runQuery(client, buildStickiness(options));
}
