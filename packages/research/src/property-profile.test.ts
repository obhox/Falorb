import { describe, expect, it } from "vitest";
import { parsePropertyProfile } from "./property-profile";

describe("parsePropertyProfile", () => {
  it("parses a well-formed response", () => {
    const raw =
      "SUMMARY: A product analytics platform for indie founders.\n" +
      "ICP: Solo founders running several small SaaS products.\n" +
      "FEATURES: funnels, session replay, cross-project insights\n" +
      "KEYWORDS: product analytics, mixpanel alternative, founder dashboard";

    expect(parsePropertyProfile(raw)).toEqual({
      summary: "A product analytics platform for indie founders.",
      icp: "Solo founders running several small SaaS products.",
      keyFeatures: ["funnels", "session replay", "cross-project insights"],
      suggestedKeywords: ["product analytics", "mixpanel alternative", "founder dashboard"],
    });
  });

  it("treats \"unknown\" as null for scalar fields", () => {
    const raw = "SUMMARY: unknown\nICP: unknown\nFEATURES: unknown\nKEYWORDS: unknown";
    expect(parsePropertyProfile(raw)).toEqual({
      summary: null,
      icp: null,
      keyFeatures: [],
      suggestedKeywords: [],
    });
  });

  it("tolerates missing lines", () => {
    expect(parsePropertyProfile("SUMMARY: Just a summary.")).toEqual({
      summary: "Just a summary.",
      icp: null,
      keyFeatures: [],
      suggestedKeywords: [],
    });
  });
});
