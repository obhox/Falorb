import * as React from "react";

/** Inline trend line with a fading area fill. */
export interface SparklineProps {
  data?: number[];
  width?: number | string;
  height?: number;
  color?: string;
  /** Gradient area under the line. Default true. */
  fill?: boolean;
  strokeWidth?: number;
  style?: React.CSSProperties;
}
export declare function Sparkline(props: SparklineProps): React.JSX.Element;
