import "server-only";
import Redis from "ioredis";
import {
  MemoryRateLimitBackend,
  RateLimiter,
  type RateLimitBackend,
  type RateLimitRule,
} from "@falorb/core";

/**
 * The dashboard's rate limiter.
 *
 * Backed by Redis when one is configured, and by this process's memory when
 * one is not. The fallback is not a compromise for production — the production
 * stack always has Redis, because the ingest pipeline cannot run without it —
 * it is what keeps local development working with no extra service, and what
 * ensures an install that somehow lacks Redis still gets a ceiling rather than
 * none.
 *
 * The Redis client is created lazily and shared. Next compiles each route
 * separately in development, and a client constructed at module scope in a
 * route file becomes one connection per route; a module-level singleton here
 * is one connection per process, the same arrangement `serverExternalPackages`
 * in `next.config.mjs` exists to protect for the database pools.
 */

let backend: RateLimitBackend | undefined;
let limiter: RateLimiter | undefined;

function resolveBackend(): RateLimitBackend {
  if (backend) return backend;

  const url = process.env.REDIS_URL;
  if (!url) {
    backend = new MemoryRateLimitBackend();
    return backend;
  }

  const redis = new Redis(url, {
    // The dashboard must stay responsive when Redis is slow or gone. The
    // limiter fails open on a rejected call, so a fast rejection is strictly
    // better than a hanging request — the alternative is the limiter becoming
    // the outage it exists to prevent.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  // Otherwise an unreachable Redis emits an unhandled 'error' event and takes
  // the process down — a limiter that crashes the app it protects.
  redis.on("error", (error) => {
    console.error("[rate-limit] redis:", String(error));
  });

  backend = {
    async increment(key, ttlSeconds) {
      const [[, count]] = (await redis
        .multi()
        .incr(key)
        .expire(key, ttlSeconds, "NX")
        .exec()) as [[Error | null, number], [Error | null, number]];
      return count;
    },
  };
  return backend;
}

export function rateLimiter(): RateLimiter {
  limiter ??= new RateLimiter(resolveBackend());
  return limiter;
}

/**
 * The address to count against.
 *
 * `x-forwarded-for` is trustworthy here for the same reason it is in
 * `packages/auth/src/index.ts`: both proxies in front of this — Caddy in
 * `infra/Caddyfile`, Coolify's in the production stack — overwrite it with the
 * real peer. It must not be forwarded from anywhere else.
 *
 * An unattributable request gets a shared bucket rather than an exemption.
 * Falling back to "no key, no limit" would mean anyone able to strip the
 * header is unlimited, which is the wrong way round.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unattributed";
}

/**
 * Ceilings, in one place so they can be read against each other.
 *
 * Chosen with an order of magnitude of headroom over any legitimate use: a
 * shared report link is opened by people, not scripts, and 60 opens a minute
 * from one address is already far past a team watching a launch. The point is
 * to bound a loop, not to police browsing.
 */
export const LIMITS = {
  /** Public token routes: /share, /badge, /benchmark, /waitlist, /r. */
  publicRead: { windowSeconds: 60, max: 60 } satisfies RateLimitRule,
  /**
   * Joining a waitlist. Tight, because this is an unauthenticated *write* that
   * stores an email address — the shape of an abuse vector rather than a load
   * one, and nobody signs up five times a minute by accident.
   */
  waitlistJoin: { windowSeconds: 60, max: 5 } satisfies RateLimitRule,
} as const;
