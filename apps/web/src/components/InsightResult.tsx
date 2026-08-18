"use client";

import { BarSeries, ChartFrame, DonutChart } from "@falorb/ui";
import { compact } from "@/lib/format";

/**
 * The insight result, drawn three ways.
 *
 * The donut is capped at six segments with the remainder collapsed into
 * "Other" — a ring with twenty slices communicates nothing, and the long tail
 * is exactly what a donut is worst at showing. The table view is there for
 * when the tail is the point.
 */

export interface InsightRow {
  label: string;
  value: number;
  formatted: string;
  meta?: string;
}

export function InsightResult({
  title,
  subtitle,
  chart,
  rows,
}: {
  title: string;
  subtitle: string;
  chart: "bars" | "donut" | "table";
  rows: InsightRow[];
}) {
  if (chart === "donut") {
    const top = rows.slice(0, 6);
    const rest = rows.slice(6).reduce((sum, row) => sum + row.value, 0);
    const segments = [
      ...top.map((row, index) => ({
        label: row.label,
        value: row.value,
        color: index === 0 ? "var(--series-1)" : `var(--series-${Math.min(index + 1, 5)})`,
      })),
      ...(rest > 0 ? [{ label: "Other", value: rest, color: "var(--series-5)" }] : []),
    ];

    return (
      <ChartFrame title={title} subtitle={subtitle} height={280}>
        <DonutChart segments={segments} size={200} />
      </ChartFrame>
    );
  }

  if (chart === "bars") {
    return (
      <ChartFrame title={title} subtitle={subtitle} height={260}>
        <BarSeries
          height={230}
          data={rows.slice(0, 16).map((row) => ({ label: row.label, value: row.value }))}
        />
      </ChartFrame>
    );
  }

  return (
    <ChartFrame title={title} subtitle={subtitle}>
      <div className="falorb-scroll-x">
      <div style={{ display: "grid", gap: 1 }}>
        <div style={head}>
          <span>{title}</span>
          <span style={{ textAlign: "right" }}>Value</span>
          <span style={{ textAlign: "right" }}>Share</span>
        </div>
        {rows.map((row) => {
          const total = rows.reduce((sum, r) => sum + r.value, 0) || 1;
          return (
            <div key={row.label} style={body}>
              <span
                style={{
                  color: "var(--text-body)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={row.label}
              >
                {row.label}
              </span>
              <span style={figure}>{row.formatted}</span>
              <span style={{ ...figure, color: "var(--text-muted)" }}>
                {((row.value / total) * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
      </div>
    </ChartFrame>
  );
}


const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 120px 80px",
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
  gridTemplateColumns: "minmax(0,1fr) 120px 80px",
  gap: 12,
  minHeight: "var(--row-height-dense)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
  fontSize: "var(--size-label)",
};

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  color: "var(--text-primary)",
  textAlign: "right",
};
