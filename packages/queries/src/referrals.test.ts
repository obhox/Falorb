import { describe, expect, it } from "vitest";
import { buildReferralClicks } from "./referrals";

describe("buildReferralClicks", () => {
  const scope = { projectIds: [1], range: { from: 0, to: 1000 } };

  it("groups by ref_code and counts landing pageviews and visitors", () => {
    const { sql } = buildReferralClicks(scope);
    expect(sql).toContain("props_str['ref_code']");
    expect(sql).toContain("countIf(name = '$pageview')");
    expect(sql).toContain("uniqCombined64(person_id)");
    expect(sql).toContain("GROUP BY ref_code_a");
  });

  it("excludes events with no referral code", () => {
    const { sql } = buildReferralClicks(scope);
    expect(sql).toContain("props_str['ref_code'] != ''");
  });

  it("ranks by clicks descending", () => {
    const { sql } = buildReferralClicks(scope);
    expect(sql).toContain("ORDER BY clicks DESC");
  });

  it("scopes by project and date range as bound parameters", () => {
    const { params } = buildReferralClicks(scope);
    expect(params.projectIds).toEqual([1]);
  });
});
