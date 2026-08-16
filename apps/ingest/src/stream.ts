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
   * Fixed-window rate limit.
   *
   * Fails **closed** on an empty key. It used to return true, which meant any
   * request whose client address could not be determined was exempt from rate
   * limiting entirely — and the key is derived from that address, so stripping
   * the forwarding headers was enough to get unlimited writes into another
   * customer's reports. An unattributable request is precisely the one that
   * should not be trusted with an exemption.
   */
  async allow(key: string, limitPerMinute: number): Promise<boolean> {
    if (!key) return false;
    const bucket = `falorb:rl:${Math.floor(Date.now() / 60_000)}:${key}`;
    const count = await this.redis.incr(bucket);
    if (count === 1) await this.redis.expire(bucket, 120);
    return count <= limitPerMinute;
  }

  /**
   * Per-project ceiling, independent of who is sending.
   *
   * The per-IP limit does nothing against a flood spread across many
   * addresses, which is the shape of the attack that matters here: the public
   * key is in the customer's page source, so anyone can write to their
   * reports. This bounds the damage to one project's minute rather than the
   * cluster's.
   */
  async allowProject(projectId: number, limitPerMinute: number): Promise<boolean> {
    const bucket = `falorb:rlp:${Math.floor(Date.now() / 60_000)}:${projectId}`;
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
