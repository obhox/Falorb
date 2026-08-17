import { requireProject } from "@/server/session";
import { getCollectorHealth, getConnectionStatus } from "@/server/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connection status for one property.
 *
 * Polled by the settings panel while someone is testing their install. A plain
 * JSON endpoint rather than SSE: this is a handful of requests over a minute
 * or two, not a continuous stream, and a poll the browser can abandon by
 * navigating away is simpler than a connection that must be torn down.
 *
 * `since` narrows the answer to "has anything arrived *since I pressed test*",
 * which is the question that distinguishes a live install from one that merely
 * worked at some point in the past.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ project: string }> },
) {
  // Resolved against the session's own projects, so this leaks nothing about a
  // property the caller does not own.
  const { project } = await requireProject((await params).project);

  const since = Number(new URL(request.url).searchParams.get("since"));
  const [status, collector] = await Promise.all([
    getConnectionStatus(project.id),
    getCollectorHealth(),
  ]);

  const lastEventMs = status.lastEventAt
    ? new Date(`${status.lastEventAt.replace(" ", "T")}Z`).getTime()
    : 0;

  return Response.json(
    {
      ...status,
      collector,
      // The test's own verdict: something arrived after the moment the reader
      // pressed the button, so the snippet is demonstrably working right now.
      receivedSinceTest: Number.isFinite(since) && since > 0 ? lastEventMs > since : false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
