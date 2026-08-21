"use client";

import Link from "next/link";
import { Card, Icon, IconButton } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { deleteInsight } from "@/server/actions/insights";
import type { SavedInsight } from "@/server/insights";
import { CHARTS, DIMENSIONS, METRICS } from "@/lib/insight-options";

/** Named cross-project queries, as links back into the builder — same
 * shape as `SavedFunnels`, the URL is the whole definition. */
export function SavedInsights({
  insights,
  active,
  canManage,
}: {
  insights: SavedInsight[];
  /** The current metric/dim/chart/projects, to mark the open one. */
  active: { metric: string; dimension: string; chart: string; projectSlugs: string[] };
  canManage: boolean;
}) {
  const { run, pending } = useAction();

  if (insights.length === 0) return null;

  return (
    <Card title="Saved insights" subtitle={`${insights.length} defined`} padding="var(--pad-panel)">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {insights.map((insight) => {
          const isActive =
            insight.metric === active.metric &&
            insight.dimension === active.dimension &&
            insight.chart === active.chart &&
            sameSet(insight.projectSlugs, active.projectSlugs);

          const query = new URLSearchParams({
            metric: insight.metric,
            dim: insight.dimension,
            chart: insight.chart,
          });
          if (insight.projectSlugs.length) query.set("projects", insight.projectSlugs.join(","));

          return (
            <div
              key={insight.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                borderRadius: "var(--radius-2)",
                background: isActive ? "var(--surface-selected)" : "var(--surface-raised)",
                border: `1px solid ${isActive ? "var(--border-strong)" : "var(--border-subtle)"}`,
                minWidth: 0,
              }}
            >
              <Link
                href={`/insights?${query.toString()}`}
                data-plain
                style={{ display: "grid", gap: 2, padding: "8px 4px 8px 12px", textDecoration: "none", minWidth: 0 }}
              >
                <span
                  style={{
                    fontSize: "var(--size-body-sm)",
                    color: isActive ? "var(--text-primary)" : "var(--text-body)",
                  }}
                >
                  {insight.name}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  {METRICS[insight.metric]} by {DIMENSIONS[insight.dimension].toLowerCase()} · {CHARTS[insight.chart]}
                </span>
              </Link>
              {canManage && (
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={`Delete ${insight.name}`}
                  icon={<Icon name="x" size={12} />}
                  disabled={pending}
                  onClick={() => run(() => deleteInsight(insight.id), { success: "Insight deleted" })}
                  style={{ marginRight: 4 }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}
