import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { breakdown, crossProjectPeople, totals, trend } from "@/server/analytics";
import { peopleIdentities } from "@/server/people";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { RangePicker } from "@/components/shell/RangePicker";
import { StatStrip } from "@/components/StatStrip";
import { TrendPanel } from "@/components/TrendPanel";
import { InsightControls } from "@/components/InsightControls";
import { asKey, CHARTS, DIMENSIONS, METRICS } from "@/lib/insight-options";
import { InsightResult, type InsightRow } from "@/components/InsightResult";
import { Empty } from "@/components/Empty";
import { bucketGrid, seriesFromTrend } from "@/lib/series";
import {
  countryLabel,
  delta,
  duration,
  eventLabel,
  money,
  num,
  personLabel,
  relative,
} from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const metadata: Metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

/**
 * The cross-project query builder.
 *
 * Everything here spans properties, which is what separates it from a project
 * tab. The panel that justifies the whole identity graph is at the bottom:
 * people who used more than one of your products, which no per-property view
 * can answer.
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const search = await searchParams;
  const resolved = resolveRange({
    range: one(search, "range"),
    from: one(search, "from"),
    to: one(search, "to"),
  });

  if (session.projects.length === 0) {
    return (
      <>
        <PageHeader title="Insights" />
        <PageBody>
          <Empty
            icon="layout-dashboard"
            title="Nothing to compare yet"
            body="Insights compare properties against each other. Add a property first."
          />
        </PageBody>
      </>
    );
  }

  const metric = asKey(one(search, "metric"), METRICS, "visitors");
  const dimension = asKey(one(search, "dim"), DIMENSIONS, "channel");
  const chart = asKey(one(search, "chart"), CHARTS, "bars");

  // An unrecognised slug is dropped rather than erroring: these come from a
  // shared link, and a property may have been archived since it was sent.
  const requested = (one(search, "projects") ?? "").split(",").filter(Boolean);
  const selected = requested.filter((slug) => session.projects.some((p) => p.slug === slug));
  const scoped = selected.length
    ? session.projects.filter((p) => selected.includes(p.slug))
    : session.projects;
  const projectIds = scoped.map((p) => p.id);

  const [current, previous, rows, overTime, crossing] = await Promise.all([
    totals({ projectIds, range: resolved.range }),
    totals({ projectIds, range: resolved.previous }),
    breakdown({ projectIds, range: resolved.range, field: dimension, limit: 20 }),
    trend({ projectIds, range: resolved.range, metric, interval: resolved.interval }),
    crossProjectPeople({
      projectIds,
      range: resolved.range,
      minProjects: 2,
      limit: 25,
    }),
  ]);

  const buckets = bucketGrid(resolved.range, resolved.interval);
  const series = seriesFromTrend(overTime, buckets.keys, resolved.interval);
  const now = Date.now();

  // The cross-product list comes back from ClickHouse as bare person ids;
  // identity lives in Postgres, so it is resolved here in one batched read.
  const identities = await peopleIdentities(
    session.workspace.organizationId,
    crossing.map((person) => person.person_id),
  );

  const projectsById = new Map(session.projects.map((p) => [p.id, p]));

  const resultRows: InsightRow[] = rows
    .map((row) => {
      const value = valueOf(row, metric);
      return {
        label: labelFor(dimension, row.value),
        value,
        formatted: metric === "revenue" ? money(value) : num(value),
        meta: `${num(row.visitors)} people`,
      };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHeader
        title="Insights"
        meta={`${scoped.length} of ${session.projects.length} properties · ${resolved.label.toLowerCase()}`}
        actions={<RangePicker />}
      />

      <PageBody>
        <StatStrip
          stats={[
            {
              label: "Unique visitors",
              value: num(current.visitors),
              delta: delta(current.visitors, previous.visitors),
              footnote: "deduplicated across properties",
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
              label: "Revenue",
              value: money(current.revenue),
              delta: delta(current.revenue, previous.revenue),
            },
          ]}
        />

        <Card tone="panel">
          <InsightControls
            metric={metric}
            dimension={dimension}
            chart={chart}
            projects={session.projects}
            selected={selected}
          />
        </Card>

        <TrendPanel
          title={`${METRICS[metric]} across ${scoped.length === 1 ? "1 property" : `${scoped.length} properties`}`}
          subtitle={`${resolved.label} · by ${resolved.interval}`}
          labels={buckets.labels}
          series={[{ name: METRICS[metric], data: series }]}
        />

        {resultRows.length === 0 ? (
          <Card>
            <Empty
              icon="chart-no-axes-column"
              title={`No ${METRICS[metric].toLowerCase()} by ${DIMENSIONS[dimension].toLowerCase()}`}
              body="Nothing was recorded for this combination. Try a different dimension, or widen the range."
            />
          </Card>
        ) : (
          <InsightResult
            title={`${METRICS[metric]} by ${DIMENSIONS[dimension].toLowerCase()}`}
            subtitle={`${resultRows.length} values · ${resolved.label.toLowerCase()}`}
            chart={chart}
            rows={resultRows}
          />
        )}

        <Card
          title="People across products"
          subtitle="Seen on two or more properties in this range"
        >
          {crossing.length === 0 ? (
            <Empty
              dense
              icon="users"
              title="Nobody crossed properties"
              body="Cross-product identity needs a shared identify() id or a decorated cross-domain link. With neither, anonymous visitors stay separate by design."
            />
          ) : (
            <div className="falorb-scroll-x">
            <div style={{ display: "grid", gap: 1 }}>
              <div style={head}>
                <span>Person</span>
                <span style={{ textAlign: "right" }}>Properties</span>
                <span>Which</span>
                <span style={{ textAlign: "right" }}>Events</span>
                <span style={{ textAlign: "right" }}>Last seen</span>
              </div>

              {crossing.map((person) => (
                <Link
                  key={person.person_id}
                  href={`/people/${person.person_id}`}
                  data-plain
                  style={{ ...body, textDecoration: "none" }}
                >
                  {(() => {
                    const identity = identities.get(person.person_id);
                    const known = identity?.email ?? identity?.name ?? null;
                    return (
                      <span
                        style={{
                          fontFamily: known ? "var(--font-sans)" : "var(--font-mono)",
                          fontSize: known ? "var(--size-label)" : "var(--size-micro)",
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={known ?? person.person_id}
                      >
                        {known ?? personLabel(person.person_id)}
                      </span>
                    );
                  })()}
                  <span style={figure}>{num(person.project_count)}</span>
                  <span
                    style={{
                      fontSize: "var(--size-micro)",
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {person.project_ids
                      .map((id) => projectsById.get(id)?.name ?? `#${id}`)
                      .join(" · ")}
                  </span>
                  <span style={figure}>{num(person.total_events)}</span>
                  <span style={{ ...figure, color: "var(--text-muted)" }}>
                    {relative(person.last_seen, now)}
                  </span>
                </Link>
              ))}
            </div>
            </div>
          )}
        </Card>
      </PageBody>
    </>
  );
}

function valueOf(
  row: { visitors: number; sessions: number; pageviews: number; events: number; revenue: number },
  metric: keyof typeof METRICS,
): number {
  return row[metric];
}

function labelFor(dimension: keyof typeof DIMENSIONS, value: string): string {
  if (!value) return dimension === "channel" ? "Direct" : "Unknown";
  if (dimension === "country") return countryLabel(value);
  if (dimension === "event") return eventLabel(value);
  return value;
}


const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "100px 90px minmax(0,1fr) 90px 100px",
  gap: 12,
  height: 30,
  alignItems: "center",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--size-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-label)",
  color: "var(--text-muted)",
  fontWeight: "var(--wt-medium)",
};

const body: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "100px 90px minmax(0,1fr) 90px 100px",
  gap: 12,
  minHeight: "var(--row-height-dense)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-micro)",
  color: "var(--text-primary)",
  textAlign: "right",
};
