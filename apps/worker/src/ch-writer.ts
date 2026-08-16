import type { ClickHouseClient } from "@clickhouse/client";
import type Redis from "ioredis";
import type { FalorbEvent } from "@falorb/core";
import { toEventRow } from "@falorb/db";

export const EVENT_STREAM = "falorb:events";
export const CONSUMER_GROUP = "ch-writer";

export interface WriterOptions {
  /** Flush when this many events are buffered. */
  batchSize: number;
  /** Flush at least this often, even when the buffer is not full. */
  flushIntervalMs: number;
  /** Block this long waiting for new stream entries. */
  blockMs: number;
  consumerName: string;
}

const DEFAULTS: WriterOptions = {
  batchSize: 1000,
  flushIntervalMs: 1000,
  blockMs: 5000,
  consumerName: `writer-${process.pid}`,
};

/**
 * Drains the Redis stream into ClickHouse.
 *
 * The ordering here is the whole point: entries are only ACKed *after*
 * ClickHouse confirms the insert. If the process dies mid-batch, those entries
 * remain pending in the consumer group and are redelivered, so a crash costs a
 * duplicate rather than a hole. Duplicates are the cheaper failure — event_id
 * makes them identifiable, whereas lost pageviews are gone permanently.
 */
export class ChWriter {
  private opts: WriterOptions;
  private buffer: FalorbEvent[] = [];
  private pendingIds: string[] = [];
  private running = false;
  private lastFlush = Date.now();

  constructor(
    private redis: Redis,
    private clickhouse: ClickHouseClient,
    opts: Partial<WriterOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  async start(): Promise<void> {
    await this.ensureGroup();
    this.running = true;
    console.log(`[ch-writer] consuming ${EVENT_STREAM} as ${this.opts.consumerName}`);

    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        console.error("[ch-writer] tick failed:", String(error));
        // Back off briefly so a persistent failure does not become a hot loop.
        await sleep(1000);
      }
    }
    await this.flush();
  }

  stop(): void {
    this.running = false;
  }

  private async ensureGroup(): Promise<void> {
    try {
      // MKSTREAM creates the stream if ingest has not written to it yet, which
      // is the normal case on a cold deploy.
      await this.redis.xgroup("CREATE", EVENT_STREAM, CONSUMER_GROUP, "0", "MKSTREAM");
    } catch (error) {
      const message = String(error);
      if (!message.includes("BUSYGROUP")) throw error;
    }
  }

  private async tick(): Promise<void> {
    const response = (await this.redis.xreadgroup(
      "GROUP",
      CONSUMER_GROUP,
      this.opts.consumerName,
      "COUNT",
      this.opts.batchSize,
      "BLOCK",
      this.opts.blockMs,
      "STREAMS",
      EVENT_STREAM,
      ">",
    )) as Array<[string, Array<[string, string[]]>]> | null;

    if (response) {
      for (const [, entries] of response) {
        for (const [id, fields] of entries) {
          this.pendingIds.push(id);
          const payload = fieldValue(fields, "d");
          if (!payload) continue;
          try {
            this.buffer.push(JSON.parse(payload) as FalorbEvent);
          } catch {
            // A single malformed entry must not wedge the stream; it is ACKed
            // with the batch and dropped.
            console.warn(`[ch-writer] skipping unparseable entry ${id}`);
          }
        }
      }
    }

    const due = Date.now() - this.lastFlush >= this.opts.flushIntervalMs;
    if (this.buffer.length >= this.opts.batchSize || (this.pendingIds.length && due)) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (!this.pendingIds.length) {
      this.lastFlush = Date.now();
      return;
    }

    const events = this.buffer;
    const ids = this.pendingIds;
    this.buffer = [];
    this.pendingIds = [];

    if (events.length) {
      await this.clickhouse.insert({
        table: "events",
        values: events.map(toEventRow),
        format: "JSONEachRow",
      });
    }

    // Only now is it safe to acknowledge.
    await this.redis.xack(EVENT_STREAM, CONSUMER_GROUP, ...ids);
    this.lastFlush = Date.now();
    if (events.length) console.log(`[ch-writer] wrote ${events.length} events`);
  }

  /**
   * Reclaim entries left pending by a writer that died before ACKing. Without
   * this, a crashed consumer's in-flight events would sit unclaimed forever.
   */
  async reclaimStale(idleMs = 60_000): Promise<number> {
    const result = (await this.redis.xautoclaim(
      EVENT_STREAM,
      CONSUMER_GROUP,
      this.opts.consumerName,
      idleMs,
      "0",
      "COUNT",
      1000,
    )) as [string, Array<[string, string[]]>, string[]];

    const entries = result[1] ?? [];
    for (const [id, fields] of entries) {
      this.pendingIds.push(id);
      const payload = fieldValue(fields, "d");
      if (payload) {
        try {
          this.buffer.push(JSON.parse(payload) as FalorbEvent);
        } catch {
          /* drop malformed */
        }
      }
    }
    if (entries.length) {
      console.log(`[ch-writer] reclaimed ${entries.length} stale entries`);
      await this.flush();
    }
    return entries.length;
  }
}

function fieldValue(fields: string[], key: string): string | undefined {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === key) return fields[i + 1];
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
