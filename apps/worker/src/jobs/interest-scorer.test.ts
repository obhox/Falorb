import { describe, expect, it } from "vitest";
import { computeScores } from "./interest-scorer";

const NOW = Date.parse("2026-08-16T12:00:00Z");

function topic(name: string, events: number, daysAgo = 0) {
  return {
    person_id: "p1",
    topic: name,
    events,
    last_seen: new Date(NOW - daysAgo * 86_400_000).toISOString(),
  };
}

describe("computeScores", () => {
  it("normalises the strongest interest to 100", () => {
    const scores = computeScores(
      [topic("email", 10), topic("design", 2)],
      new Map([
        ["email", 50],
        ["design", 50],
      ]),
      100,
      NOW,
    );
    expect(Math.max(...Object.values(scores))).toBe(100);
  });

  it("ranks a rare topic above a popular one at equal engagement", () => {
    const scores = computeScores(
      [topic("niche", 5), topic("homepage", 5)],
      new Map([
        ["niche", 3], // only 3 people ever touched it
        ["homepage", 900], // almost everyone did
      ]),
      1000,
      NOW,
    );
    expect(scores.niche!).toBeGreaterThan(scores.homepage!);
  });

  it("decays an old interest below a recent one at equal engagement", () => {
    const scores = computeScores(
      [topic("recent", 5, 0), topic("stale", 5, 120)],
      new Map([
        ["recent", 50],
        ["stale", 50],
      ]),
      100,
      NOW,
    );
    expect(scores.recent!).toBeGreaterThan(scores.stale!);
  });

  it("grows sub-linearly in event count", () => {
    const few = computeScores(
      [topic("a", 2), topic("filler", 1)],
      new Map([
        ["a", 10],
        ["filler", 10],
      ]),
      100,
      NOW,
    );
    const many = computeScores(
      [topic("a", 64), topic("filler", 1)],
      new Map([
        ["a", 10],
        ["filler", 10],
      ]),
      100,
      NOW,
    );
    // 32x the events must not produce anything like 32x the relative weight.
    const fewRatio = few.a! / few.filler!;
    const manyRatio = many.a! / many.filler!;
    expect(manyRatio).toBeGreaterThan(fewRatio);
    expect(manyRatio).toBeLessThan(fewRatio * 10);
  });

  it("caps the number of topics kept per person", () => {
    const topics = Array.from({ length: 40 }, (_, i) => topic(`t${i}`, 40 - i));
    const popularity = new Map(topics.map((t) => [t.topic, 10]));
    const scores = computeScores(topics, popularity, 100, NOW);
    expect(Object.keys(scores).length).toBeLessThanOrEqual(12);
  });

  it("returns nothing for a person with no topics", () => {
    expect(computeScores([], new Map(), 100, NOW)).toEqual({});
  });

  it("ignores topics with zero events", () => {
    const scores = computeScores([topic("ghost", 0)], new Map([["ghost", 5]]), 100, NOW);
    expect(scores).toEqual({});
  });
});
