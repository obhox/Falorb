import "server-only";
import Redis from "ioredis";

/**
 * Write side of the demand-driven integration syncs — see
 * `packages/core/src/sync-demand.ts` and `apps/worker/src/jobs/*-sync.ts`.
 * A page load (or a fresh connect, in `actions/integrations.ts`) flags its
 * org here; the worker drains the flag on its next tick and syncs only what
 * was actually asked for.
 *
 * Same lazy-singleton-Redis shape as this directory's `rate-limit.ts`, and
 * the same failure posture: a Redis hiccup must never break a
 * page load, so every call swallows its own error rather than throwing. The
 * cost of a swallowed error here is a delayed sync, not a broken page — the
 * next read (or the worker's own retry via the connection's cooldown) tries
 * again.
 */

let redis: Redis | undefined;

function resolveRedis(): Redis | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (redis) return redis;

  redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  redis.on("error", (error) => {
    console.error("[sync-demand] redis:", String(error));
  });
  return redis;
}

/** Flag `organizationId` as wanting a fresh `provider` sync on the next worker tick. */
export async function markSyncRequested(organizationId: string, provider: string): Promise<void> {
  try {
    await resolveRedis()?.sadd(`falorb:sync:requested:${provider}`, organizationId);
  } catch (error) {
    console.error("[sync-demand] request failed:", String(error));
  }
}
