import { Card, ChartFrame, RetentionMatrix } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { retention, stickiness } from "@/server/analytics";
import { PageBody } from "@/components/shell/PageHeader";
import { GranularityPicker } from "@/components/GranularityPicker";
import { BreakdownCard } from "@/components/BreakdownCard";
import { Empty } from "@/components/Empty";
import { num, pct, shortDate } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

const GRANULARITIES = ["day", "week", "month"] as const;
type Granularity = (typeof GRANULARITIES)[number];

/**
 * Cohort retention.
 *
 * Intensity in the grid is glacier alpha, never a second hue — the design
 * system's rule for heatmaps and cohort grids, and the reason a retention
 * triangle here reads as one quantity rather than as a rainbow.
 */
export default async function RetentionPage({
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

  const granularity = asGranularity(one(search, "by"), resolved.interval);
  const options = {
    projectIds: [project.id],
    range: resolved.range,
    granularity,
    periods: granularity === "day" ? 14 : granularity === "week" ? 8 : 6,
  };

  const [cohorts, sticky] = await Promise.all([retention(options), stickiness(options)]);

  const periodLabel = granularity === "day" ? "Day" : granularity === "month" ? "Month" : "Week";
  const now = Date.now();

  // Stickiness is a distribution of "days active" against "how many people",
  // not a cohort table — so the useful summary is what share of people showed
  // up on more than one day.
  const stickyTotal = sticky.reduce((sum, row) => sum + row.people, 0);
  const repeatShare =
    stickyTotal > 0
      ? (sticky
          .filter((row) => row.active_days > 1)
          .reduce((sum, row) => sum + row.people, 0) /
          stickyTotal) *
        100
      : 0;

  return (
    <PageBody>
      <ChartFrame
        title="Cohort retention"
        subtitle={`People grouped by when they were first seen, then followed forward · ${resolved.label.toLowerCase()}`}
        actions={<GranularityPicker current={granularity} options={[...GRANULARITIES]} />}
        height={280}
      >
        {cohorts.length === 0 ? (
          <Empty
            icon="grid-3x3"
            title="No cohorts in this range"
            body="Retention needs people who were first seen inside the range and had a chance to return. Widen the range to at least two periods."
          />
        ) : (
          <RetentionMatrix
            periodLabel={periodLabel}
            cohorts={cohorts.map((row) => ({
              label: shortDate(row.cohort, now),
              size: row.cohortSize,
              // Trailing periods that have not elapsed yet are null, not zero.
              // Zero would read as "nobody came back" when the truth is
              // "that week has not happened".
              values: row.percentages.map((value) =>
                Number.isFinite(value) ? Math.round(value * 10) / 10 : null,
              ),
            }))}
          />
        )}
      </ChartFrame>

      <Card
        title="Stickiness"
        subtitle="How many distinct days each person was active in this range — a daily habit versus a single visit"
      >
        {stickyTotal === 0 ? (
          <Empty
            dense
            icon="repeat"
            title="Nothing to measure yet"
            body="Stickiness reads the person_daily rollup, which the sessionizer fills as sessions close. A very new property will have no rows yet."
          />
        ) : (
          <BreakdownCard
            title="Active days per person"
            subtitle={`${num(stickyTotal)} people · ${repeatShare.toFixed(1)}% came back on more than one day`}
            emptyBody="No activity recorded."
            items={sticky.map((row) => ({
              label: `${row.active_days} ${row.active_days === 1 ? "day" : "days"}`,
              value: num(row.people),
              count: row.people,
              meta: pct((row.people / stickyTotal) * 100),
            }))}
          />
        )}
      </Card>
    </PageBody>
  );
}

function asGranularity(value: string | undefined, interval: string): Granularity {
  if ((GRANULARITIES as readonly string[]).includes(value ?? "")) return value as Granularity;
  // Default follows the range: daily cohorts over a year would be 365 rows.
  return interval === "hour" || interval === "day" ? "day" : interval === "month" ? "month" : "week";
}
