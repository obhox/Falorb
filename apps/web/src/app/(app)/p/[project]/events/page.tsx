import { Card } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { breakdown, sessionList, trend } from "@/server/analytics";
import { PageBody } from "@/components/shell/PageHeader";
import { TrendPanel } from "@/components/TrendPanel";
import { BreakdownCard } from "@/components/BreakdownCard";
import { SessionTable } from "@/components/SessionTable";
import { Empty } from "@/components/Empty";
import { bucketGrid, seriesByName } from "@/lib/series";
import { eventLabel, num } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/**
 * The event explorer: what is being sent, how often, and the sessions it
 * happened in.
 *
 * The trend is broken down by event name so the shape of each stream is
 * visible at once — three series maximum, which is the chart rule, and the
 * largest is the one that gets the glacier accent.
 */
export default async function EventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { project } = await requireProject((await params).project);
  const search = await searchParams;
  const resolved = resolveRange({
    range: one(search, "range"),
    from: one(search, "from"),
    to: one(search, "to"),
  });

  const selected = one(search, "event");
  const scope = {
    projectIds: [project.id],
    range: resolved.range,
    // A selected event narrows every panel on the page, not just the list.
    ...(selected ? { filters: [{ field: "event", op: "eq" as const, value: selected }] } : {}),
  };

  const [names, byName, properties, sessions] = await Promise.all([
    breakdown({
      projectIds: [project.id],
      range: resolved.range,
      field: "event",
      limit: 20,
      orderBy: "events",
    }),
    trend({ ...scope, metric: "events", interval: resolved.interval, breakdown: "event", limit: 3 }),
    breakdown({ ...scope, field: "path", limit: 10, orderBy: "events" }),
    sessionList({ ...scope, limit: 40 }),
  ]);

  const buckets = bucketGrid(resolved.range, resolved.interval);
  const series = seriesByName(byName, buckets.keys, resolved.interval).slice(0, 3);
  const now = Date.now();
  const total = names.reduce((sum, row) => sum + row.events, 0);

  return (
    <PageBody>
      {total === 0 ? (
        <Card>
          <Empty
            icon="radio"
            title="No events in this range"
            body={`Nothing was recorded in the last ${resolved.label.toLowerCase()}. Check the snippet on the settings tab, or widen the range.`}
          />
        </Card>
      ) : (
        <>
          <TrendPanel
            title={selected ? `${eventLabel(selected)} over time` : "Events over time"}
            subtitle={`${resolved.label} · by ${resolved.interval}${
              selected ? "" : " · top 3 event names"
            }`}
            labels={buckets.labels}
            series={series.map((s) => ({ name: eventLabel(s.name), data: s.data }))}
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "var(--space-6)",
            }}
          >
            <BreakdownCard
              title="Event names"
              subtitle={selected ? "click to clear the filter" : "click to filter this page"}
              emptyBody="No named events were recorded in this range."
              items={names.map((row) => ({
                label: eventLabel(row.value),
                value: num(row.events),
                count: row.events,
                meta: `${num(row.visitors)} people`,
                href: buildHref(search, row.value === selected ? undefined : row.value),
              }))}
            />

            <BreakdownCard
              title={selected ? `Pages sending ${eventLabel(selected)}` : "Pages by event volume"}
              emptyBody="No page context was attached to these events."
              items={properties.map((row) => ({
                label: row.value || "/",
                value: num(row.events),
                count: row.events,
              }))}
            />
          </div>

          <Card
            title="Sessions"
            subtitle={
              selected
                ? `Most recent sessions containing ${eventLabel(selected)}`
                : "Most recent sessions"
            }
            bodyStyle={{ padding: "var(--space-5) 0 0" }}
          >
            <SessionTable
              sessions={sessions.map((row) => ({
                id: row.session_id,
                personId: row.person_id,
                startedAt: row.started_at,
                durationSec: row.duration_sec,
                pageviews: row.pageviews,
                events: row.events,
                entryPath: row.entry_path,
                exitPath: row.exit_path,
                channel: row.channel,
                country: row.country,
                device: row.device_type,
                browser: row.browser,
                isBounce: row.is_bounce,
              }))}
              now={now}
            />
          </Card>
        </>
      )}
    </PageBody>
  );
}

/** Preserve the range while toggling the selected event. */
function buildHref(search: SearchParams, event: string | undefined): string {
  const next = new URLSearchParams();
  for (const key of ["range", "from", "to"]) {
    const value = one(search, key);
    if (value) next.set(key, value);
  }
  if (event) next.set("event", event);
  const query = next.toString();
  return query ? `?${query}` : "?";
}
