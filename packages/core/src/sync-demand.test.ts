import { describe, expect, it } from "vitest";
import { isSyncStale } from "./sync-demand";

describe("isSyncStale", () => {
  it("treats a connection that has never synced as stale", () => {
    expect(isSyncStale(null, 5 * 60_000)).toBe(true);
    expect(isSyncStale(undefined, 5 * 60_000)).toBe(true);
  });

  it("is stale once the cooldown has fully elapsed, not before", () => {
    const cooldownMs = 5 * 60_000;
    // A second of margin either side of the boundary, so the real time that
    // elapses between building `justSynced` here and `isSyncStale` calling
    // its own `Date.now()` can't flip either assertion.
    const justSynced = new Date(Date.now() - (cooldownMs - 1000));
    const longAgo = new Date(Date.now() - (cooldownMs + 1000));

    expect(isSyncStale(justSynced, cooldownMs)).toBe(false);
    expect(isSyncStale(longAgo, cooldownMs)).toBe(true);
  });
});
