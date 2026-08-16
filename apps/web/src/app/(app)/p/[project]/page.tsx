import { requireProject } from "@/server/session";
import { breakdown, totals, trend } from "@/server/analytics";
import { PageBody } from "@/components/shell/PageHeader";
import { StatStrip } from "@/components/StatStrip";
import { BreakdownCard } from "@/components/BreakdownCard";
import { TrendPanel } from "@/components/TrendPanel";
import { bucketGrid, seriesFromTrend } from "@/lib/series";
import { countryLabel, delta, duration, num, pct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/**
 * A property's summary: headline figures, the visitors/sessions time series,
 * and the four breakdowns that answer "who came, from where, on what".
 *
 * Eight queries, all independent, all issued at once. ClickHouse handles the
 * concurrency far better than the browser would handle eight waterfalled
 * round-trips.
 */
export default async function ProjectSummaryPage({
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

  const scope = { projectIds: [project.id], range: resolved.range };

  const [
    current,
    previous,
    visitorTrend,
    sessionTrend,
    pages,
    sources,
    countries,
    devices,
  ] = await Promise.all([
    totals(scope),
    totals({ projectIds: [project.id], range: resolved.previous }),
    trend({ ...scope, metric: "visitors", interval: resolved.interval }),
    trend({ ...scope, metric: "sessions", interval: resolved.interval }),
    breakdown({ ...scope, field: "path", limit: 8 }),
    breakdown({ ...scope, field: "channel", limit: 8 }),
    breakdown({ ...scope, field: "country", limit: 8 }),
    breakdown({ ...scope, field: "device_type", limit: 8 }),
  ]);

  // Grid from the selected range, not from the rows: an axis built from the
  // rows would begin at the first bucket that happened to have traffic, so a
  // quiet first week would silently vanish from the chart.
  const buckets = bucketGrid(resolved.range, resolved.interval);
  const visitors = seriesFromTrend(visitorTrend, buckets.keys, resolved.interval);
  const sessions = seriesFromTrend(sessionTrend, buckets.keys, resolved.interval);

  return (
    <PageBody>
      <StatStrip
        stats={[
          {
            label: "Unique visitors",
            value: num(current.visitors),
            delta: delta(current.visitors, previous.visitors),
          },
          {
            label: "Sessions",
            value: num(current.sessions),
            delta: delta(current.sessions, previous.sessions),
          },
          {
            label: "Pageviews",
            value: num(current.pageviews),
            delta: delta(current.pageviews, previous.pageviews),
          },
          {
            label: "Avg. session",
            value: duration(current.avg_session_sec),
            delta: delta(current.avg_session_sec, previous.avg_session_sec),
          },
          {
            label: "Bounce rate",
            value: pct(current.bounce_rate),
            delta: delta(current.bounce_rate, previous.bounce_rate),
            invertDelta: true,
          },
        ]}
      />

      <TrendPanel
        title="Visitors and sessions"
        subtitle={`${resolved.label} · by ${resolved.interval}`}
        labels={buckets.labels}
        series={[
          { name: "Visitors", data: visitors },
          { name: "Sessions", data: sessions },
        ]}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "var(--space-6)",
        }}
      >
        <BreakdownCard
          title="Top pages"
          subtitle="by unique visitors"
          emptyBody="No pageviews were recorded in this range."
          items={pages.map((row) => ({
            label: row.value || "/",
            value: num(row.visitors),
            count: row.visitors,
            meta: `${num(row.pageviews)} views`,
            href: `/p/${project.slug}/paths?path=${encodeURIComponent(row.value)}`,
          }))}
        />

        <BreakdownCard
          title="Channels"
          subtitle="how people arrived"
          emptyBody="No referrer or campaign information was captured in this range."
          items={sources.map((row) => ({
            label: row.value || "Direct",
            value: num(row.visitors),
            count: row.visitors,
          }))}
        />

        <BreakdownCard
          title="Countries"
          subtitle="from the IP hash, never a raw address"
          emptyBody="No location could be resolved for these visits."
          items={countries.map((row) => ({
            label: countryLabel(row.value),
            value: num(row.visitors),
            count: row.visitors,
            meta: row.value || undefined,
          }))}
        />

        <BreakdownCard
          title="Devices"
          subtitle="by unique visitors"
          emptyBody="No device information was captured in this range."
          items={devices.map((row) => ({
            label: row.value || "Unknown",
            value: num(row.visitors),
            count: row.visitors,
          }))}
        />
      </div>
    </PageBody>
  );
}
