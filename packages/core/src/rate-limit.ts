/**
 * Fixed-window rate limiting, backend-agnostic.
 *
 * The collector has had per-IP and per-project ceilings since it shipped
 * (`apps/ingest/src/stream.ts`), and better-auth applies per-path limits to the
 * sign-in routes. The dashboard had neither, which left every public,
 * unauthenticated route — a shared report link, an embeddable badge, a
 * waitlist form — running unbounded ClickHouse and Postgres work for anyone
 * willing to send requests in a loop. Guessing a 32-byte token is not the
 * threat; exhausting the query budget that serves every tenant is.
 *
 * Fixed windows rather than a sliding log or token bucket, matching the
 * collector: a fixed window is one INCR and one EXPIRE, it needs no per-caller
 * state beyond a counter, and its worst case — twice the limit across a window
 * boundary — is irrelevant against ceilings chosen with an order of magnitude
 * of headroom. Precision here would cost more than it buys.
 *
 * The backend is injected rather than imported so this stays testable without
 * a Redis, and so a caller with no Redis at all can still have a limiter. See
 * `apps/web/src/server/rate-limit.ts` for both.
 */

export interface RateLimitBackend {
  /**
   * Increment `key` and return its new value, setting `ttlSeconds` when the
   * counter is created. Both Redis (`INCR` + `EXPIRE`) and the in-memory map
   * below satisfy this in one round trip.
   */
  increment(key: string, ttlSeconds: number): Promise<number>;
}

export interface RateLimitRule {
  /** Window length. The counter resets on this boundary. */
  windowSeconds: number;
  /** Requests permitted per window, per key. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in the current window. Never negative. */
  remaining: number;
  /** Seconds until the window resets — the value for `Retry-After`. */
  retryAfterSeconds: number;
}

/**
 * The window a moment falls in.
 *
 * Exported for tests, which need to reason about boundaries without waiting
 * for one.
 */
export function windowStart(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / (windowSeconds * 1000));
}

export class RateLimiter {
  constructor(private backend: RateLimitBackend) {}

  /**
   * Count one request against `key` and say whether it is permitted.
   *
   * A backend failure permits the request. That is a deliberate fail-open: the
   * limiter protects against load, and turning a Redis outage into a total
   * dashboard outage would convert a degradation into an incident. The
   * collector makes the opposite choice for an unattributable request, and is
   * right to — it is the write path, and an unlimited write path is a data
   * integrity problem rather than a capacity one.
   */
  async check(namespace: string, key: string, rule: RateLimitRule, nowMs = Date.now()): Promise<RateLimitResult> {
    const window = windowStart(nowMs, rule.windowSeconds);
    const elapsed = Math.floor(nowMs / 1000) % rule.windowSeconds;
    const retryAfterSeconds = rule.windowSeconds - elapsed;

    let count: number;
    try {
      // The TTL outlives the window so a counter created at its very end is
      // still expired rather than leaked, without ever suppressing the next
      // window's count.
      count = await this.backend.increment(`falorb:rl:${namespace}:${window}:${key}`, rule.windowSeconds * 2);
    } catch {
      return { allowed: true, remaining: rule.max, retryAfterSeconds: 0 };
    }

    return {
      allowed: count <= rule.max,
      remaining: Math.max(0, rule.max - count),
      retryAfterSeconds,
    };
  }
}

/**
 * A backend held in this process's memory.
 *
 * Correct for a single replica and for local development, and wrong the moment
 * there are two — the effective limit multiplies by the replica count, exactly
 * as better-auth's in-memory store does. It exists so that an install with no
 * Redis configured still gets a ceiling rather than none at all, which is
 * strictly better than the nothing that was here before.
 */
export class MemoryRateLimitBackend implements RateLimitBackend {
  private counters = new Map<string, { count: number; expiresAtMs: number }>();
  private lastSweepMs = 0;

  async increment(key: string, ttlSeconds: number, nowMs = Date.now()): Promise<number> {
    this.sweep(nowMs);

    const existing = this.counters.get(key);
    if (existing && existing.expiresAtMs > nowMs) {
      existing.count += 1;
      return existing.count;
    }

    this.counters.set(key, { count: 1, expiresAtMs: nowMs + ttlSeconds * 1000 });
    return 1;
  }

  /**
   * Drop expired counters, at most once a second.
   *
   * Without this the map grows by one entry per distinct client address per
   * window and never shrinks — a memory leak that a scan on every request
   * would trade for a CPU one.
   */
  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweepMs < 1000) return;
    this.lastSweepMs = nowMs;
    for (const [key, entry] of this.counters) {
      if (entry.expiresAtMs <= nowMs) this.counters.delete(key);
    }
  }

  /** Test seam: how many counters are being tracked. */
  get size(): number {
    return this.counters.size;
  }
}
