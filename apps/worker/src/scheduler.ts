import type Redis from "ioredis";

/**
 * Periodic job runner with distributed locking.
 *
 * Deliberately not BullMQ. These jobs are periodic sweeps over state that is
 * already durable in Postgres and ClickHouse, not discrete units of work that
 * must each be tracked, retried and acknowledged. A queue would add a second
 * source of truth about what has been processed — and every job here is
 * idempotent and watermark-driven, which makes that bookkeeping redundant.
 *
 * The Redis lock exists so that running two worker replicas does not run every
 * sweep twice. A lock is held with a TTL rather than released on completion
 * alone, so a worker that dies mid-job cannot wedge the schedule permanently.
 */

export interface Job {
  name: string;
  /** How often to run, in milliseconds. */
  intervalMs: number;
  /** Upper bound on a single run; the lock is held for this long. */
  timeoutMs?: number;
  run: () => Promise<void>;
  /** Skip the initial run at startup and wait a full interval first. */
  skipOnBoot?: boolean;
}

export class Scheduler {
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopping = false;
  private inFlight = new Set<string>();

  constructor(
    private redis: Redis,
    private instanceId: string,
  ) {}

  add(job: Job): void {
    const tick = () => void this.execute(job);
    if (!job.skipOnBoot) {
      // Stagger the first run so a restart does not fire every job at once.
      setTimeout(tick, 2000 + Math.floor(this.timers.length * 1500));
    }
    this.timers.push(setInterval(tick, job.intervalMs));
  }

  private async execute(job: Job): Promise<void> {
    if (this.stopping) return;

    // Guard against a slow job overlapping itself within this process, which
    // the Redis lock alone would not prevent once the TTL elapses.
    if (this.inFlight.has(job.name)) {
      console.warn(`[${job.name}] previous run still in flight, skipping`);
      return;
    }

    const lockKey = `falorb:lock:${job.name}`;
    const ttlMs = job.timeoutMs ?? Math.max(job.intervalMs * 2, 60_000);

    const acquired = await this.redis.set(lockKey, this.instanceId, "PX", ttlMs, "NX");
    if (!acquired) return;

    this.inFlight.add(job.name);
    const startedAt = Date.now();
    try {
      await job.run();
      const ms = Date.now() - startedAt;
      if (ms > 1000) console.log(`[${job.name}] completed in ${ms}ms`);
    } catch (error) {
      console.error(`[${job.name}] failed:`, error instanceof Error ? error.message : error);
    } finally {
      this.inFlight.delete(job.name);
      // Release only if still ours — a run that overran its TTL must not
      // delete a lock another worker has since taken.
      await this.releaseIfOwned(lockKey);
    }
  }

  private async releaseIfOwned(lockKey: string): Promise<void> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `;
    try {
      await this.redis.eval(script, 1, lockKey, this.instanceId);
    } catch {
      // The lock expires on its own; a failed release is not worth retrying.
    }
  }

  stop(): void {
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}

/**
 * Watermark storage.
 *
 * Every sweep processes "everything since last time". Persisting that boundary
 * in Redis rather than recomputing it keeps each run bounded regardless of how
 * long the worker was down.
 */
export class Watermarks {
  constructor(private redis: Redis) {}

  async get(name: string, fallbackMs: number): Promise<number> {
    const raw = await this.redis.get(`falorb:wm:${name}`);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : Date.now() - fallbackMs;
  }

  async set(name: string, epochMs: number): Promise<void> {
    await this.redis.set(`falorb:wm:${name}`, String(epochMs));
  }
}
