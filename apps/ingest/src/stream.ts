import Redis from "ioredis";
import type { FalorbEvent } from "@falorb/core";
import { EVENT_STREAM } from "./config";

/**
 * The durability boundary between ingest and storage.
 *
 * Ingest writes here and returns 200 immediately; the ch-writer worker drains
 * the stream into ClickHouse. This exists so that ClickHouse being slow,
 * merging, or restarting never turns into dropped pageviews or a slow response
 * on someone's website. Redis is configured with appendonly so the buffer also
 * survives a container restart.
 */
export class EventStream {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      // Ingest must stay responsive even when Redis is unreachable; failing
      // fast lets the handler return 202 rather than hanging the visitor's
      // browser request.
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    this.redis.on("error", (e) => console.error("[redis]", e.message));
  }

  /**
   * Append events to the stream.
   *
   * MAXLEN ~ caps the buffer at roughly a million entries. The `~` makes the
   * trim approximate, which lets Redis drop whole nodes instead of exact
   * counting — far cheaper, and the precise cutoff does not matter for a
   * backlog that should never approach the cap in normal operation.
   */
  async publish(events: FalorbEvent[]): Promise<void> {
    if (!events.length) return;
    const pipeline = this.redis.pipeline();
    for (const event of events) {
      pipeline.xadd(EVENT_STREAM, "MAXLEN", "~", "1000000", "*", "d", JSON.stringify(event));
    }
    await pipeline.exec();
  }

  /**
   * Fixed-window rate limit keyed on the daily IP hash.
   *
   * Deliberately coarse: this is a guard against a runaway script or a crude
   * flood, not a security control. Returns true when the request is allowed.
   */
  async allow(key: string, limitPerMinute: number): Promise<boolean> {
    if (!key) return true;
    const bucket = `falorb:rl:${Math.floor(Date.now() / 60_000)}:${key}`;
    const count = await this.redis.incr(bucket);
    if (count === 1) await this.redis.expire(bucket, 120);
    return count <= limitPerMinute;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
