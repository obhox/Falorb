import * as React from "react";

export interface LineSeries {
  name: string;
  /** Defaults to --series-1. */
  color?: string;
  data: number[];
  /** Gradient area under the line. */
  fill?: boolean;
  dashed?: boolean;
}

/**
 * Multi-series line/area chart with y-axis, hairline grid and hover crosshair.
 * @startingPoint section="Charts" subtitle="LineChart, StackedBars, DonutChart, FunnelChart, SankeyDiagram, HeatmapGrid, RetentionMatrix" viewport="700x340"
 */
export interface LineChartProps {
  series?: LineSeries[];
  /** X labels, one per data point. */
  labels?: string[];
  height?: number;
  /** Number of horizontal grid lines / y labels. Default 4. */
  yTicks?: number;
  /** Y tick formatter. */
  format?: (v: number) => string;
  /** Fires with the hovered index (or null) so a caller can drive a tooltip. */
  onHover?: (index: number | null) => void;
  showGrid?: boolean;
  style?: React.CSSProperties;
}
export declare function LineChart(props: LineChartProps): React.JSX.Element;
