import * as React from "react";

/**
 * Metric block: micro-label, oversized mono figure, delta, optional sparkline.
 * @startingPoint section="Data" subtitle="StatTile, DeltaPill, Sparkline, BarSeries, MetricBar, DataTable" viewport="700x300"
 */
export interface StatTileProps {
  label?: React.ReactNode;
  /** Pre-formatted string — format upstream, the tile never rounds for you. */
  value?: React.ReactNode;
  unit?: React.ReactNode;
  /** Number (rendered as %) or a pre-formatted string. */
  delta?: number | string;
  /** True when down is good (bounce rate, load time). */
  invertDelta?: boolean;
  /** Trend values for the inline sparkline. */
  series?: number[];
  footnote?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** Set false when tiles sit in an already-bordered strip. */
  bordered?: boolean;
  style?: React.CSSProperties;
}
export declare function StatTile(props: StatTileProps): React.JSX.Element;
