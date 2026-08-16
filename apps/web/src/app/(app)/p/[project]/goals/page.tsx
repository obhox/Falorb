import { Card } from "@falorb/ui";
import type { AttributionModel } from "@falorb/queries";
import { requireProject } from "@/server/session";
import { evaluateGoals, listGoals, toDefinition } from "@/server/goals";
import { attribution, breakdown, totals, trend } from "@/server/analytics";
import { PageBody } from "@/components/shell/PageHeader";
import { StatStrip } from "@/components/StatStrip";
import { TrendPanel } from "@/components/TrendPanel";
import { BreakdownCard } from "@/components/BreakdownCard";
import { GranularityPicker } from "@/components/GranularityPicker";
import { Empty } from "@/components/Empty";
import { GoalsPanel, type GoalView } from "./GoalsPanel";
import { bucketGrid, seriesFromTrend } from "@/lib/series";
import { delta, money, num, pct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

const MODELS = ["first_touch", "last_touch", "linear"] as const;

const MODEL_NOTES: Record<AttributionModel, string> = {
  first_touch:
    "Credits whatever originally found the person. Favours discovery channels — content, search, social.",
  last_touch:
    "Credits whatever was present when they converted. Favours closing channels — direct, email, branded search.",
  linear:
    "Splits credit evenly across every distinct channel that touched them. Flatters nothing.",
};

/**
 * Conversions and revenue.
 *
 * Attribution is a real model here, not a raw breakdown, and the model is the
 * reader's choice: the same spend looks good or bad depending on which one is
 * applied, so picking one silently on their behalf would be making a budget
 * argument for them.
 */
export default async function GoalsPage({
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

  const model = asModel(one(search, "model"));
  const goals = await listGoals(project.id);
  const scope = { projectIds: [project.id], range: resolved.range };

  const [evaluated, current, previous, revenueTrend] = await Promise.all([
    evaluateGoals(project.id, resolved.range, goals),
    totals(scope),
    totals({ projectIds: [project.id], range: resolved.previous }),
    trend({ ...scope, metric: "revenue", interval: resolved.interval }),
  ]);

  // Attribution is per goal. The highest-converting one is the default subject,
  // since attributing a goal nobody completed produces an empty table.
  const primary = [...evaluated].sort((a, b) => b.conversions - a.conversions)[0];

  const [attributed, byChannel] = await Promise.all([
    primary && primary.conversions > 0
      ? attribution({ ...scope, goal: toDefinition(primary.goal), model, limit: 12 })
      : Promise.resolve([]),
    breakdown({ ...scope, field: "channel", limit: 8 }),
  ]);

  const buckets = bucketGrid(resolved.range, resolved.interval);
  const revenueSeries = seriesFromTrend(revenueTrend, buckets.keys, resolved.interval);

  const views: GoalView[] = evaluated.map((result) => ({
    id: result.goal.id,
    name: result.goal.name,
    kind: result.goal.kind,
    matcher: result.goal.matcher,
    active: result.goal.active,
    currency: result.goal.currency,
    visitors: result.uniqueConverters,
    conversions: result.conversions,
    conversionRate: result.conversionRate,
    revenue: result.revenue,
    revenueIsAssumed: result.revenueMayBeAssumed,
  }));

  // Inactive goals are not evaluated, but they must still be listed — a goal
  // that vanishes when switched off looks deleted.
  const inactive: GoalView[] = goals
    .filter((goal) => !goal.active)
    .map((goal) => ({
      id: goal.id,
      name: goal.name,
      kind: goal.kind,
      matcher: goal.matcher,
      active: false,
      currency: goal.currency,
      visitors: 0,
      conversions: 0,
      conversionRate: 0,
      revenue: 0,
      revenueIsAssumed: false,
    }));

  const totalConversions = views.reduce((sum, view) => sum + view.conversions, 0);

  return (
    <PageBody>
      <StatStrip
        stats={[
          {
            label: "Revenue",
            value: money(current.revenue),
            delta: delta(current.revenue, previous.revenue),
          },
          {
            label: "Conversions",
            value: num(totalConversions),
            footnote: `${views.length} active ${views.length === 1 ? "goal" : "goals"}`,
          },
          {
            label: "Visitors",
            value: num(current.visitors),
            delta: delta(current.visitors, previous.visitors),
          },
          {
            label: "Revenue per visitor",
            value: current.visitors > 0 ? money(current.revenue / current.visitors) : money(0),
          },
        ]}
      />

      <GoalsPanel slug={project.slug} goals={[...views, ...inactive]} />

      <TrendPanel
        title="Revenue over time"
        subtitle={`${resolved.label} · by ${resolved.interval}`}
        labels={buckets.labels}
        series={[{ name: "Revenue", data: revenueSeries }]}
      />

      <Card
        title="Attribution"
        subtitle={
          primary
            ? `${primary.name} · ${MODEL_NOTES[model]}`
            : "Define a goal to attribute conversions back to a channel"
        }
        action={
          <GranularityPicker
            param="model"
            current={model}
            options={[...MODELS]}
            labels={{ first_touch: "First touch", last_touch: "Last touch", linear: "Linear" }}
          />
        }
      >
        {attributed.length === 0 ? (
          <Empty
            dense
            icon="route"
            title={primary ? "No attributable touches" : "No goals to attribute"}
            body={
              primary
                ? "Everyone who converted arrived with no identifiable channel — typical of direct traffic only."
                : "Attribution follows a goal. Add one above and its conversions can be traced back to the channels that produced them."
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 1 }}>
            <div style={head}>
              <span>Channel</span>
              <span>Source</span>
              <span style={{ textAlign: "right" }}>Conversions</span>
              <span style={{ textAlign: "right" }}>Revenue</span>
              <span style={{ textAlign: "right" }}>Share</span>
            </div>

            {attributed.map((row) => (
              <div key={`${row.channel}-${row.source}`} style={body}>
                <span style={{ color: "var(--text-body)" }}>{row.channel || "Direct"}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.source || "—"}
                </span>
                <span style={figure}>{num(row.conversions)}</span>
                <span style={figure}>{money(row.revenue)}</span>
                <span style={{ ...figure, color: "var(--text-muted)" }}>{pct(row.share)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BreakdownCard
        title="Revenue by channel"
        subtitle="unattributed — the channel of the session the revenue landed in"
        emptyBody="No revenue events were recorded in this range."
        items={byChannel
          .filter((row) => row.revenue > 0)
          .map((row) => ({
            label: row.value || "Direct",
            value: money(row.revenue),
            count: row.revenue,
            meta: `${num(row.visitors)} people`,
          }))}
      />
    </PageBody>
  );
}

function asModel(value: string | undefined): AttributionModel {
  return (MODELS as readonly string[]).includes(value ?? "")
    ? (value as AttributionModel)
    : "last_touch";
}

const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr) 110px 120px 80px",
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
  gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr) 110px 120px 80px",
  gap: 12,
  minHeight: "var(--row-height-dense)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
  fontSize: "var(--size-label)",
};

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-label)",
  color: "var(--text-primary)",
  textAlign: "right",
};
