import { describe, expect, it } from "vitest";
import { MemoryRateLimitBackend, RateLimiter, windowStart, type RateLimitBackend } from "./rate-limit";

const RULE = { windowSeconds: 60, max: 3 };

describe("windowStart", () => {
  it("puts two moments in the same window until the boundary", () => {
    // Aligned to a window boundary, because windows are absolute rather than
    // relative to first contact — that is what makes them shareable between
    // replicas without any coordination.
    const base = Math.ceil(1_700_000_000_000 / 60_000) * 60_000;
    expect(windowStart(base, 60)).toBe(windowStart(base + 59_999, 60));
    expect(windowStart(base, 60)).not.toBe(windowStart(base + 60_000, 60));
  });
});

describe("RateLimiter", () => {
  it("permits up to the limit and refuses past it", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitBackend());
    const now = Math.ceil(1_700_000_000_000 / 60_000) * 60_000;

    for (let i = 0; i < RULE.max; i++) {
      const result = await limiter.check("share", "1.2.3.4", RULE, now);
      expect(result.allowed).toBe(true);
    }

    const refused = await limiter.check("share", "1.2.3.4", RULE, now);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each key separately, so one noisy client cannot refuse another", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitBackend());
    const now = Math.ceil(1_700_000_000_000 / 60_000) * 60_000;

    for (let i = 0; i <= RULE.max; i++) await limiter.check("share", "1.2.3.4", RULE, now);

    expect((await limiter.check("share", "5.6.7.8", RULE, now)).allowed).toBe(true);
  });

  it("counts each namespace separately", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitBackend());
    const now = Math.ceil(1_700_000_000_000 / 60_000) * 60_000;

    for (let i = 0; i <= RULE.max; i++) await limiter.check("share", "1.2.3.4", RULE, now);

    expect((await limiter.check("waitlist", "1.2.3.4", RULE, now)).allowed).toBe(true);
  });

  it("resets on the window boundary", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitBackend());
    const now = Math.ceil(1_700_000_000_000 / 60_000) * 60_000;

    for (let i = 0; i <= RULE.max; i++) await limiter.check("share", "1.2.3.4", RULE, now);
    expect((await limiter.check("share", "1.2.3.4", RULE, now)).allowed).toBe(false);

    expect((await limiter.check("share", "1.2.3.4", RULE, now + 60_000)).allowed).toBe(true);
  });

  it("fails open when the backend is unreachable", async () => {
    // A Redis outage must degrade the ceiling, not the dashboard. The limiter
    // exists to bound load; turning its own failure into a total outage would
    // convert a degradation into an incident.
    const broken: RateLimitBackend = {
      increment: () => Promise.reject(new Error("ECONNREFUSED")),
    };
    const result = await new RateLimiter(broken).check("share", "1.2.3.4", RULE);
    expect(result.allowed).toBe(true);
  });
});

describe("MemoryRateLimitBackend", () => {
  it("expires counters instead of growing without bound", async () => {
    const backend = new MemoryRateLimitBackend();
    const now = Math.ceil(1_700_000_000_000 / 60_000) * 60_000;

    for (let i = 0; i < 50; i++) await backend.increment(`k${i}`, 60, now);
    expect(backend.size).toBe(50);

    // Past the TTL, and past the once-a-second sweep throttle.
    await backend.increment("fresh", 60, now + 61_000);
    expect(backend.size).toBe(1);
  });
});
