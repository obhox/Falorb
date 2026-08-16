import * as React from "react";

/** Card shell every chart sits in: title, right-hand controls, plot area, legend. */
export interface ChartFrameProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned controls — Select, SegmentedControl, IconButton. */
  actions?: React.ReactNode;
  /** Rendered under the plot; normally a <Legend />. */
  legend?: React.ReactNode;
  /** Minimum plot height in px. The frame grows to fill its grid cell. */
  height?: number;
  tone?: "card" | "panel";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function ChartFrame(props: ChartFrameProps): JSX.Element;
