import type { Metadata } from "next";
import Link from "next/link";
import { Button, Icon } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { portfolioOverview, portfolioSparklines, totals } from "@/server/analytics";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { RangePicker } from "@/components/shell/RangePicker";
import { PropertyRow } from "@/components/PropertyRow";
import { StatStrip } from "@/components/StatStrip";
import { Empty } from "@/components/Empty";
import { delta, duration, num } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const metadata: Metadata = { title: "All properties" };
export const dynamic = "force-dynamic";

/**
 * The portfolio view — the screen the whole product is arranged around: open
 * one page and see every property at once, then drill into one.
 *
 * The three queries run concurrently. They are independent, and a serial chain
 * would make the slowest screen in the app exactly as slow as the sum of its
 * parts for no reason.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const resolved = resolveRange({
    range: one(params, "range"),
    from: one(params, "from"),
    to: one(params, "to"),
  });

  if (session.projects.length === 0) return <NoProjects />;

  const projectIds = session.projects.map((p) => p.id);

  const [rows, sparklines, current, previous] = await Promise.all([
    portfolioOverview({ projectIds, range: resolved.range }),
    portfolioSparklines({ projectIds, range: resolved.range }),
    totals({ projectIds, range: resolved.range }),
    totals({ projectIds, range: resolved.previous }),
  ]);

  const byProject = new Map(rows.map((row) => [row.project_id, row]));

  // Sparkline points arrive as one row per project per day. Grouping here keeps
  // the query flat — one scan for every property rather than one per property.
  const seriesByProject = new Map<number, number[]>();
  for (const point of sparklines) {
    const list = seriesByProject.get(point.project_id) ?? [];
    list.push(point.visitors);
    seriesByProject.set(point.project_id, list);
  }

  const ordered = [...session.projects].sort(
    (a, b) => (byProject.get(b.id)?.visitors ?? 0) - (byProject.get(a.id)?.visitors ?? 0),
  );

  const totalVisitors = rows.reduce((sum, row) => sum + row.visitors, 0);
  const portfolioSeries = collapseSeries(sparklines);

  return (
    <>
      <PageHeader
        title="All properties"
        meta={`${session.projects.length} tracked · ${resolved.label.toLowerCase()}`}
        actions={<RangePicker />}
      />

      <PageBody>
        <StatStrip
          stats={[
            {
              label: "Unique visitors",
              value: num(current.visitors),
              delta: delta(current.visitors, previous.visitors),
              series: portfolioSeries,
            },
            {
              label: "Sessions",
              value: num(current.sessions),
              delta: delta(current.sessions, previous.sessions),
            },
            {
              label: "Avg. session",
              value: duration(current.avg_session_sec),
              delta: delta(current.avg_session_sec, previous.avg_session_sec),
            },
            {
              label: "Bounce rate",
              value: `${(Math.round(current.bounce_rate * 10) / 10).toFixed(1)}%`,
              delta: delta(current.bounce_rate, previous.bounce_rate),
              // A falling bounce rate is an improvement, so the pill's colour
              // has to be inverted or it reads backwards.
              invertDelta: true,
            },
          ]}
        />

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "var(--ls-label)",
                color: "var(--text-muted)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              Properties
            </span>
            <span
              style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}
            >
              sorted by visitors ↓
            </span>
          </div>

          <div className="falorb-stagger" style={{ display: "grid", gap: 6 }}>
            {ordered.map((project, index) => {
              const row = byProject.get(project.id);
              return (
                <div key={project.id} style={{ "--i": index } as React.CSSProperties}>
                  <PropertyRow
                    href={`/p/${project.slug}`}
                    domain={project.domains[0] ?? project.slug}
                    name={project.name}
                    visitors={num(row?.visitors ?? 0)}
                    sessions={num(row?.sessions ?? 0)}
                    series={seriesByProject.get(project.id) ?? []}
                    delta={delta(row?.visitors ?? 0, row?.prev_visitors ?? 0)}
                  />
                </div>
              );
            })}
          </div>

          {totalVisitors === 0 && (
            <Empty
              icon="radio"
              title="No events have arrived yet"
              body="The snippet may not be installed, or nobody has visited since it was. Open a property and check the snippet on its settings tab."
            />
          )}
        </div>
      </PageBody>
    </>
  );
}

/**
 * Portfolio-wide daily visitors.
 *
 * Summing per-project uniques overcounts anyone who visited two properties on
 * the same day, so this is labelled as what it is — the shape of traffic over
 * the period, drawn under a figure that is separately computed as a true
 * unique count by `totals`.
 */
function collapseSeries(points: { date: string; visitors: number }[]): number[] {
  const byDate = new Map<string, number>();
  for (const point of points) {
    byDate.set(point.date, (byDate.get(point.date) ?? 0) + point.visitors);
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

function NoProjects() {
  return (
    <>
      <PageHeader title="All properties" meta="none tracked yet" />
      <PageBody>
        <Empty
          icon="globe"
          title="No properties yet"
          body="A property is one site or app you collect events from. Create one to get a tracking snippet."
          action={
            <Link href="/settings/new">
              <Button variant="primary" iconLeft={<Icon name="plus" size={14} />}>
                Add property
              </Button>
            </Link>
          }
        />
      </PageBody>
    </>
  );
}
