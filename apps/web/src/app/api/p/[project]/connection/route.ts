import { requireProject } from "@/server/session";
import {
  getCollectorHealth,
  getConnectionStatus,
  getDomainStatuses,
} from "@/server/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ClickHouse hands back "2026-08-17 14:31:06.123"; this is UTC, not local. */
function toMs(clickhouseTime: string | null): number {
  return clickhouseTime ? new Date(`${clickhouseTime.replace(" ", "T")}Z`).getTime() : 0;
}

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
 *
 * The per-domain array answers it one domain at a time. A property-wide verdict
 * cannot: with two domains configured, an event from either satisfies `since`,
 * so testing the app would pass on a pageview from the marketing site and the
 * missing snippet would stay invisible.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ project: string }> },
) {
  // Resolved against the session's own projects, so this leaks nothing about a
  // property the caller does not own.
  const { project } = await requireProject((await params).project);

  const since = Number(new URL(request.url).searchParams.get("since"));
  const testing = Number.isFinite(since) && since > 0;

  const [status, collector, byProject] = await Promise.all([
    getConnectionStatus(project.id),
    getCollectorHealth(),
    getDomainStatuses([{ id: project.id, domains: project.domains }]),
  ]);
  const domains = byProject.get(project.id) ?? [];

  return Response.json(
    {
      ...status,
      collector,
      // The test's own verdict: something arrived after the moment the reader
      // pressed the button, so the snippet is demonstrably working right now.
      receivedSinceTest: testing ? toMs(status.lastEventAt) > since : false,
      domains: domains.map((domain) => ({
        ...domain,
        receivedSinceTest: testing ? toMs(domain.lastEventAt) > since : false,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
