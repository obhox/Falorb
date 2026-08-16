/**
 * Server-side SDK.
 *
 * The browser tracker cannot see the events that matter most in a SaaS: a
 * subscription upgrade processed by a Stripe webhook, a trial expiring, a
 * background job completing. Those happen with no browser attached, and
 * without a server SDK they are simply absent from the funnel.
 *
 * Zero dependencies, and safe to call from any request handler:
 *
 *   - Non-blocking. `track()` returns immediately; delivery happens on a
 *     background flush. Analytics must never add latency to a customer's
 *     request or fail it.
 *   - Never throws. A misconfigured key or an unreachable collector logs and
 *     moves on. An exception thrown out of an analytics call would take down
 *     the request that triggered it.
 */

export interface FalorbOptions {
  /** Project public key, from the dashboard. */
  projectKey: string;
  /** Collector origin, e.g. https://a.example.com */
  host: string;
  /** Events buffered before an automatic flush. */
  batchSize?: number;
  /** Milliseconds between automatic flushes. */
  flushInterval?: number;
  /** Set false in tests to disable delivery entirely. */
  enabled?: boolean;
  /** Called on delivery failure; defaults to console.error. */
  onError?: (error: Error) => void;
  /** Milliseconds before a delivery attempt is abandoned. */
  timeout?: number;
}

export type Properties = Record<string, string | number | boolean | null | undefined>;

export interface TrackOptions {
  /**
   * Who this event belongs to. Use the same id the browser passes to
   * `identify()` — that is what stitches server-side events onto the person's
   * existing timeline rather than creating a parallel identity.
   */
  userId?: string;
  /** For events before signup, pass the device id the tracker generated. */
  deviceId?: string;
  properties?: Properties;
  /** Defaults to now. Pass a Date when replaying historical events. */
  timestamp?: Date;
  /** Page context, when the event relates to one. */
  url?: string;
}

interface QueuedEvent {
  n: string;
  t: number;
  u?: string;
  p?: Properties;
  rv?: number;
  cu?: string;
  __identity: { userId?: string; deviceId?: string };
}

const DEFAULTS = {
  batchSize: 20,
  flushInterval: 5000,
  enabled: true,
  timeout: 10_000,
};

export class Falorb {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private options: Required<Omit<FalorbOptions, "onError">> & { onError: (e: Error) => void };

  constructor(options: FalorbOptions) {
    this.options = {
      ...DEFAULTS,
      ...options,
      onError: options.onError ?? ((e) => console.error("[falorb]", e.message)),
    };

    if (!options.projectKey) throw new Error("Falorb: projectKey is required");
    if (!options.host) throw new Error("Falorb: host is required");

    if (this.options.enabled) {
      this.timer = setInterval(() => void this.flush(), this.options.flushInterval);
      // Do not keep the process alive purely to flush analytics — a CLI or a
      // one-shot job should still exit when its work is done.
      this.timer.unref?.();
    }
  }

  track(event: string, options: TrackOptions = {}): void {
    this.enqueue({
      n: event,
      t: (options.timestamp ?? new Date()).getTime(),
      u: options.url,
      p: options.properties,
      __identity: { userId: options.userId, deviceId: options.deviceId },
    });
  }

  /** Attach traits to a person, and link this user id to their history. */
  identify(userId: string, traits: Properties = {}): void {
    if (!userId) return;
    this.enqueue({
      n: "$identify",
      t: Date.now(),
      p: traits,
      __identity: { userId },
    });
  }

  /**
   * Record revenue. Prefer calling this from the payment provider's webhook
   * rather than the browser — a client-side revenue call is lost whenever the
   * customer closes the tab on the confirmation page.
   */
  revenue(
    amount: number,
    options: TrackOptions & { currency?: string; event?: string } = {},
  ): void {
    this.enqueue({
      n: options.event ?? "$revenue",
      t: (options.timestamp ?? new Date()).getTime(),
      u: options.url,
      p: options.properties,
      rv: amount,
      cu: options.currency ?? "USD",
      __identity: { userId: options.userId, deviceId: options.deviceId },
    });
  }

  private enqueue(event: QueuedEvent): void {
    if (!this.options.enabled || this.closed) return;
    if (!event.__identity.userId && !event.__identity.deviceId) {
      this.options.onError(
        new Error(`event "${event.n}" dropped: needs a userId or deviceId to attribute to`),
      );
      return;
    }
    this.queue.push(event);
    if (this.queue.length >= this.options.batchSize) void this.flush();
  }

  /**
   * Send everything buffered. Awaiting this is only necessary before exit;
   * ordinary request handlers should not.
   */
  async flush(): Promise<void> {
    if (!this.queue.length) return;

    const pending = this.queue;
    this.queue = [];

    // The wire format carries one identity per batch, so events are grouped by
    // the person they belong to before sending.
    const groups = new Map<string, QueuedEvent[]>();
    for (const event of pending) {
      const key = `${event.__identity.userId ?? ""}|${event.__identity.deviceId ?? ""}`;
      const list = groups.get(key);
      if (list) list.push(event);
      else groups.set(key, [event]);
    }

    await Promise.all([...groups.values()].map((group) => this.send(group)));
  }

  private async send(events: QueuedEvent[]): Promise<void> {
    const identity = events[0]!.__identity;
    // A server-side event with only a user id still needs a stable device id;
    // deriving it from the user id keeps every such event on one device row
    // rather than inventing a new one per call.
    const deviceId = identity.deviceId ?? `srv_${identity.userId}`;

    const body = JSON.stringify({
      k: this.options.projectKey,
      d: deviceId,
      // Server events are not browser sessions; one synthetic session per
      // device keeps them from fragmenting session counts.
      s: `srv_${deviceId}`,
      i: identity.userId,
      v: "node-1",
      e: events.map(({ __identity, ...rest }) => rest),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(`${this.options.host}/e`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 204) {
        this.options.onError(new Error(`collector returned HTTP ${response.status}`));
      }
    } catch (error) {
      this.options.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Flush and stop. Call before a graceful shutdown. */
  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}

/** Convenience factory reading configuration from the environment. */
export function createFalorb(overrides: Partial<FalorbOptions> = {}): Falorb {
  return new Falorb({
    projectKey: overrides.projectKey ?? process.env.FALORB_PROJECT_KEY ?? "",
    host: overrides.host ?? process.env.FALORB_HOST ?? "http://localhost:3001",
    ...overrides,
  });
}
