import * as React from "react";

export interface HeatmapGridProps {
  /** Row labels, e.g. weekdays. */
  rows?: string[];
  /** Column labels, e.g. hours. Every other one is printed. */
  cols?: string[];
  /** values[row][col]. */
  values?: number[][];
  /** Cell height in px. Default 14. */
  cell?: number;
  gap?: number;
  format?: (v: number) => string;
  style?: React.CSSProperties;
}
export declare function HeatmapGrid(props: HeatmapGridProps): React.JSX.Element;
