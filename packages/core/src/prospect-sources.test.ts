import { describe, expect, it } from "vitest";
import { MIN_PROSPECT_RELEVANCE_SCORE, isRelevantProspect } from "./prospect-sources";

describe("isRelevantProspect", () => {
  it("keeps an unscored prospect (scoring never ran, or failed)", () => {
    expect(isRelevantProspect(null)).toBe(true);
  });

  it("keeps a prospect at or above the bar", () => {
    expect(isRelevantProspect(MIN_PROSPECT_RELEVANCE_SCORE)).toBe(true);
    expect(isRelevantProspect(100)).toBe(true);
  });

  it("filters out a prospect below the bar", () => {
    expect(isRelevantProspect(MIN_PROSPECT_RELEVANCE_SCORE - 1)).toBe(false);
    expect(isRelevantProspect(0)).toBe(false);
  });
});
