"use client";

import { ChartFrame, Legend, LineChart } from "@falorb/ui";
import { compact } from "@/lib/format";

/**
 * The main time series on a property's summary.
 *
 * At most three series, series 1 in glacier and the rest from the graphite
 * ramp — the chart rule. The primary series is the only one filled, so the eye
 * lands on it before it reads the legend.
 */

export interface TrendSeries {
  name: string;
  data: number[];
}

export function TrendPanel({
  title,
  subtitle,
  series,
  labels,
  height = 220,
  actions,
}: {
  title: string;
  subtitle?: string;
  series: TrendSeries[];
  labels: string[];
  height?: number;
  actions?: React.ReactNode;
}) {
  const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
  const shaped = series.slice(0, 3).map((s, index) => ({
    name: s.name,
    data: s.data,
    color: colors[index]!,
    fill: index === 0,
  }));

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      actions={actions}
      height={height}
      legend={
        shaped.length > 1 ? (
          <Legend items={shaped.map((s) => ({ label: s.name, color: s.color }))} />
        ) : undefined
      }
    >
      <LineChart series={shaped} labels={labels} height={height} format={compact} />
    </ChartFrame>
  );
}
