import * as React from "react";

export interface FunnelChartProps {
  /** Ordered steps; the first is treated as 100%. */
  steps?: { label: string; value: number }[];
  height?: number;
  style?: React.CSSProperties;
}
export declare function FunnelChart(props: FunnelChartProps): React.JSX.Element;
