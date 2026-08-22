/**
 * Demand-driven sync signaling, backend-agnostic.
 *
 * `buffer-sync`/`linki-sync`/`bund-ai-sync`/`stripe-sync`/`migadu-sync` (all in
 * `apps/worker/src/jobs/`) used to run on a fixed timer and fully re-poll every
 * connected org on every tick, whether or not anyone was looking at that org's
 * data. Against Buffer specifically that tripped its 24h rate limit. The fix:
 * a request for an org's mirrored data (a page load, a connect action) flags
 * that org here; the worker drains the flags on a short tick and only calls
 * out to the provider for orgs someone actually asked about, gated further by
 * a per-org cooldown so a burst of requests doesn't cause a burst of API
 * calls.
 *
 * Same shape as `rate-limit.ts` right above this file: the backend is
 * injected so this stays testable without a Redis, and each app wires its own
 * client. Unlike the rate limiter, there is no in-memory fallback — a demand
 * signal that silently no-ops when Redis is absent would mean "connect an
 * integration in dev with no Redis and never see data," which is a worse
 * failure than requiring Redis for this one feature.
 */

export interface SyncDemandBackend {
  /** Flag `orgId` as wanting a fresh `provider` sync. */
  request(provider: string, orgId: string): Promise<void>;
  /** Return every org id flagged for `provider` since the last drain, and clear them. */
  drain(provider: string): Promise<string[]>;
}

/**
 * Whether a connection last synced longer than `cooldownMs` ago — the guard
 * that stops repeated requests for the same org within a few minutes from
 * causing repeated provider calls.
 */
export function isSyncStale(lastSyncedAt: Date | null | undefined, cooldownMs: number): boolean {
  return !lastSyncedAt || Date.now() - lastSyncedAt.getTime() >= cooldownMs;
}
