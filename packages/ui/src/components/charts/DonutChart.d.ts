import * as React from "react";

export interface DonutSegment { label: string; value: number; color?: string }

export interface DonutChartProps {
  segments?: DonutSegment[];
  /** Centre figure. Defaults to the sum. */
  total?: React.ReactNode;
  totalLabel?: string;
  size?: number;
  thickness?: number;
  /** Value list beside the ring. Default true. */
  showList?: boolean;
  style?: React.CSSProperties;
}
export declare function DonutChart(props: DonutChartProps): React.JSX.Element;
