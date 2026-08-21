import { describe, expect, it } from "vitest";
import { parseRelevanceResponse } from "./reddit-listener";

describe("parseRelevanceResponse", () => {
  it("parses a well-formed response", () => {
    const result = parseRelevanceResponse("SCORE: 85\nWHY: They're actively asking for this.");
    expect(result).toEqual({ score: 85, rationale: "They're actively asking for this." });
  });

  it("clamps a score above 100", () => {
    expect(parseRelevanceResponse("SCORE: 150\nWHY: too high")?.score).toBe(100);
  });

  it("tolerates a missing WHY line", () => {
    expect(parseRelevanceResponse("SCORE: 40")).toEqual({ score: 40, rationale: "" });
  });

  it("returns null when the model didn't follow the format", () => {
    expect(parseRelevanceResponse("I think this is somewhat relevant.")).toBeNull();
  });
});
