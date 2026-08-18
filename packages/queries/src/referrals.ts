import type { ClickHouseClient } from "@clickhouse/client";
import { EVENTS, clampLimit, runQuery, scopeClause, type BuiltQuery, type QueryScope } from "./base";

/**
 * Click/visitor counts per referral code, from landing pageviews.
 *
 * "Clicks" here means pageviews carrying a `ref_code` — derived from
 * `events_v`, not a counter incremented by the `/r/<code>` redirect route.
 * Every other acquisition dimension (channel, UTM campaign, referrer) is
 * already computed this way, with no separate counter table; adding one here
 * would produce a second number that can disagree with the first (a redirect
 * an ad blocker or a non-JS destination never turns into a pageview would
 * inflate a redirect-side counter past what the leaderboard's conversion-rate
 * denominator could ever match).
 *
 * Conversions are not computed here — they require the frozen
 * `persons.firstReferralCode` in Postgres, joined against this project's
 * `referral_links` inventory, which is outside what `packages/queries` (a
 * ClickHouse-only package) can do. See `apps/web/src/server/referrals.ts` for
 * that join.
 */
export interface ReferralClickRow {
  ref_code: string;
  clicks: number;
  visitors: number;
}

export function buildReferralClicks(options: QueryScope & { limit?: number }): BuiltQuery {
  const scope = scopeClause(options);
  const limit = clampLimit(options.limit, 50, 500);

  return {
    sql: `
      SELECT
          ref_code_a AS ref_code,
          clicks_a   AS clicks,
          visitors_a AS visitors
      FROM (
          SELECT
              props_str['ref_code']       AS ref_code_a,
              countIf(name = '$pageview') AS clicks_a,
              uniqCombined64(person_id)   AS visitors_a
          FROM ${EVENTS}
          WHERE ${scope.sql}
            AND props_str['ref_code'] != ''
          GROUP BY ref_code_a
      )
      ORDER BY clicks DESC
      LIMIT {limit:UInt32}
    `,
    params: { ...scope.params, limit },
  };
}

export function referralClicks(
  client: ClickHouseClient,
  options: QueryScope & { limit?: number },
): Promise<ReferralClickRow[]> {
  return runQuery<ReferralClickRow>(client, buildReferralClicks(options));
}
