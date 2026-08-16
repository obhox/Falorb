import { requireProject } from "@/server/session";
import { liveCounts, liveFeed, liveVisitors } from "@/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events for the live view.
 *
 * SSE rather than WebSockets: this is one-directional, it survives ordinary
 * HTTP proxies, and the browser reconnects on its own. A socket would buy
 * nothing here and cost a second transport to operate.
 *
 * ClickHouse is polled rather than tailed — it has no change feed, and the
 * ingest path is Redis → worker → ClickHouse, so an event is visible within a
 * second or two of arriving. Polling at three seconds is well inside that.
 *
 * The connection closes itself after `MAX_DURATION`. A dashboard left open on
 * a spare monitor for a week would otherwise hold a Node handle and a
 * ClickHouse connection open indefinitely; the browser reconnects immediately,
 * which costs one request and releases everything.
 */

const POLL_MS = 3_000;
const MAX_DURATION_MS = 30 * 60_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ project: string }> },
) {
  // Resolves against the session's own projects — an unauthenticated request
  // redirects, and another tenant's slug 404s, before any stream is opened.
  const { project } = await requireProject((await params).project);
  const projectIds = [project.id];

  const encoder = new TextEncoder();
  // Only events newer than the moment of connection are pushed, so a client
  // that reconnects does not replay the last five minutes as though it were
  // happening now.
  let cursor = Date.now();
  const openedAt = cursor;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting mid-write.
        }
      };

      // The abort signal is the only reliable disconnect notification: a
      // browser that navigates away never sends anything, it just stops
      // reading.
      request.signal.addEventListener("abort", stop);

      const tick = async () => {
        if (closed) return;

        if (Date.now() - openedAt > MAX_DURATION_MS) {
          send("bye", { reason: "max-duration" });
          stop();
          return;
        }

        try {
          const [counts, visitors, feed] = await Promise.all([
            liveCounts({ projectIds }),
            liveVisitors({ projectIds, limit: 200 }),
            liveFeed({ projectIds, since: cursor, limit: 40 }),
          ]);

          // Advance the cursor past what was just sent so the next poll
          // returns only genuinely new rows.
          if (feed.length > 0) {
            const newest = Math.max(
              ...feed.map((row) => new Date(`${row.timestamp.replace(" ", "T")}Z`).getTime()),
            );
            if (Number.isFinite(newest)) cursor = newest + 1;
          }

          send("tick", {
            visitors: counts.reduce((sum, row) => sum + row.visitors, 0),
            byProject: counts,
            active: visitors,
            // Oldest first, so the client can append rather than reverse.
            events: [...feed].reverse(),
            at: Date.now(),
          });
        } catch (error) {
          // A transient ClickHouse error should not tear down the stream —
          // the client would reconnect into the same failure. Report it and
          // let the next poll retry.
          send("warn", {
            message: error instanceof Error ? error.message : "Query failed",
          });
        }

        if (!closed) timer = setTimeout(tick, POLL_MS);
      };

      send("hello", { project: project.slug, pollMs: POLL_MS });
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer by default, which turns a live stream into a
      // batch delivered on close.
      "X-Accel-Buffering": "no",
    },
  });
}
