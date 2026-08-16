import type { ClickHouseClient } from "@clickhouse/client";
import {
  EVENTS,
  clampLimit,
  runQuery,
  scopeClause,
  type BuiltQuery,
  type QueryScope,
} from "./base";

/**
 * Goal conversions and revenue attribution.
 *
 * A goal is either an event name or a URL path pattern. Both are compiled to a
 * bound parameter — a path pattern supports a trailing `*` and nothing else,
 * deliberately, because a full glob or regex over a user-supplied string is
 * both a performance and an injection surface for no real gain.
 */

export interface GoalDefinition {
  id: string;
  name: string;
  kind: "event" | "path";
  matcher: string;
  /** Assumed value when the converting event carries no explicit revenue. */
  value?: number | null;
}

export interface GoalResult {
  goalId: string;
  name: string;
  conversions: number;
  uniqueConverters: number;
  conversionRate: number;
  revenue: number;
}

/**
 * Compile a goal to a SQL condition plus its parameters.
 *
 * Exported so the evaluator worker and the query layer cannot drift on what
 * "converted" means — a goal counted one way in a report and another way in an
 * alert is worse than either being slightly wrong.
 */
export function goalCondition(
  goal: GoalDefinition,
  index: number,
  params: Record<string, unknown>,
): string {
  const key = `goal${index}`;

  if (goal.kind === "path") {
    if (goal.matcher.endsWith("*")) {
      params[key] = goal.matcher.slice(0, -1);
      return `startsWith(path, {${key}:String})`;
    }
    params[key] = goal.matcher;
    return `path = {${key}:String}`;
  }

  params[key] = goal.matcher;
  return `name = {${key}:String}`;
}

export function buildGoalConversions(
  options: QueryScope & { goals: GoalDefinition[] },
): BuiltQuery {
  if (!options.goals.length) throw new Error("no goals to evaluate");

  const scope = scopeClause(options);
  const params: Record<string, unknown> = { ...scope.params };

  const selects = options.goals.map((goal, i) => {
    const condition = goalCondition(goal, i, params);
    const value = goal.value ?? 0;
    params[`val${i}`] = value;
    return `
      SELECT
          {gid${i}:String}                                   AS goal_id,
          countIf(${condition})                              AS conversions,
          uniqCombined64If(person_id, ${condition})          AS unique_converters,
          sumIf(
              ifNull(toFloat64(revenue), {val${i}:Float64}),
              ${condition}
          )                                                  AS revenue
      FROM ${EVENTS}
      WHERE ${scope.sql}`;
  });

  options.goals.forEach((goal, i) => {
    params[`gid${i}`] = goal.id;
  });

  return {
    sql: selects.join("\n      UNION ALL\n"),
    params,
  };
}

export async function goalConversions(
  client: ClickHouseClient,
  options: QueryScope & { goals: GoalDefinition[] },
): Promise<GoalResult[]> {
  if (!options.goals.length) return [];

  const rows = await runQuery<{
    goal_id: string;
    conversions: string;
    unique_converters: string;
    revenue: string;
  }>(client, buildGoalConversions(options));

  // Denominator is everyone in scope, so the rate answers "what share of
  // visitors converted" rather than "what share of events were conversions".
  const totalResult = await runQuery<{ visitors: string }>(client, {
    sql: `SELECT uniqCombined64(person_id) AS visitors FROM ${EVENTS} WHERE ${scopeClause(options).sql}`,
    params: scopeClause(options).params,
  });
  const visitors = Number(totalResult[0]?.visitors ?? 0);

  const byId = new Map(rows.map((r) => [r.goal_id, r]));

  return options.goals.map((goal) => {
    const row = byId.get(goal.id);
    const converters = Number(row?.unique_converters ?? 0);
    return {
      goalId: goal.id,
      name: goal.name,
      conversions: Number(row?.conversions ?? 0),
      uniqueConverters: converters,
      conversionRate: visitors ? Math.round((converters / visitors) * 10000) / 100 : 0,
      revenue: Number(row?.revenue ?? 0),
    };
  });
}

export type AttributionModel = "first_touch" | "last_touch" | "linear";

export interface AttributionRow {
  channel: string;
  source: string;
  conversions: number;
  revenue: number;
  share: number;
}

/**
 * Attribute conversions and revenue back to the acquisition channel.
 *
 * The model matters and the choice is not neutral:
 *
 *   first_touch credits whatever originally found the person, which favours
 *   discovery channels — content, search, social.
 *
 *   last_touch credits whatever was present when they converted, which
 *   favours closing channels — direct, email, branded search.
 *
 *   linear splits the credit evenly across every distinct channel that
 *   touched them, which flatters nothing and is usually the fairest default
 *   for a portfolio where people arrive through several routes.
 *
 * Reporting only one model tends to produce confidently wrong budget
 * decisions, so all three are available and the caller must pick.
 */
export function buildAttribution(
  options: QueryScope & { goal: GoalDefinition; model?: AttributionModel },
): BuiltQuery {
  const scope = scopeClause(options);
  const params: Record<string, unknown> = { ...scope.params };
  const condition = goalCondition(options.goal, 0, params);
  params.goalValue = options.goal.value ?? 0;

  const model = options.model ?? "last_touch";

  // Each converter's touchpoints, plus the value of their conversion.
  const base = `
      WITH converters AS (
          SELECT
              person_id,
              countIf(${condition})                                          AS conversions,
              sumIf(ifNull(toFloat64(revenue), {goalValue:Float64}), ${condition}) AS revenue
          FROM ${EVENTS}
          WHERE ${scope.sql}
          GROUP BY person_id
          HAVING conversions > 0
      ),
      touches AS (
          SELECT
              e.person_id                                    AS person_id,
              e.channel                                      AS channel,
              e.source                                       AS source,
              e.timestamp                                    AS timestamp,
              c.revenue                                      AS revenue,
              c.conversions                                  AS conversions
          FROM ${EVENTS} AS e
          INNER JOIN converters AS c ON c.person_id = e.person_id
          WHERE ${scope.sql}
            AND e.channel NOT IN ('internal', 'unknown')
      )`;

  if (model === "linear") {
    return {
      sql: `
        ${base},
        weighted AS (
            SELECT
                person_id,
                channel,
                source,
                any(revenue)      AS revenue,
                any(conversions)  AS conversions,
                -- Credit is split across the distinct channels that touched
                -- this person, so one person never contributes more than one
                -- conversion in total no matter how often they visited.
                1.0 / count(DISTINCT channel) OVER (PARTITION BY person_id) AS weight
            FROM touches
            GROUP BY person_id, channel, source
        )
        SELECT
            channel,
            source,
            round(sum(conversions * weight), 2) AS conversions,
            round(sum(revenue * weight), 2)     AS revenue,
            0                                   AS share
        FROM weighted
        GROUP BY channel, source
        ORDER BY revenue DESC, conversions DESC
      `,
      params,
    };
  }

  const pick = model === "first_touch" ? "argMin" : "argMax";
  return {
    sql: `
      ${base},
      attributed AS (
          SELECT
              person_id,
              ${pick}(channel, timestamp)  AS channel,
              ${pick}(source, timestamp)   AS source,
              any(revenue)                 AS revenue,
              any(conversions)             AS conversions
          FROM touches
          GROUP BY person_id
      )
      SELECT
          channel,
          source,
          sum(conversions)         AS conversions,
          round(sum(revenue), 2)   AS revenue,
          0                        AS share
      FROM attributed
      GROUP BY channel, source
      ORDER BY revenue DESC, conversions DESC
    `,
    params,
  };
}

export async function attribution(
  client: ClickHouseClient,
  options: QueryScope & { goal: GoalDefinition; model?: AttributionModel; limit?: number },
): Promise<AttributionRow[]> {
  const rows = await runQuery<AttributionRow>(client, buildAttribution(options));
  const totalRevenue = rows.reduce((a, r) => a + Number(r.revenue), 0);
  const totalConversions = rows.reduce((a, r) => a + Number(r.conversions), 0);

  return rows.slice(0, clampLimit(options.limit, 50, 200)).map((r) => ({
    ...r,
    conversions: Number(r.conversions),
    revenue: Number(r.revenue),
    // Share of revenue where there is any, otherwise share of conversions —
    // a channel report with all-zero shares is useless on a non-commerce site.
    share: totalRevenue
      ? Math.round((Number(r.revenue) / totalRevenue) * 1000) / 10
      : totalConversions
        ? Math.round((Number(r.conversions) / totalConversions) * 1000) / 10
        : 0,
  }));
}
