import * as React from "react";

/** Column chart: hatch-filled bars, solid on the active column. */
export interface BarSeriesProps {
  /** [{ label, value }] — labels render under the axis. */
  data?: { label: string; value: number }[];
  height?: number;
  /** Label of the highlighted column. */
  selected?: string;
  onSelect?: (label: string) => void;
  color?: string;
  showAxis?: boolean;
  style?: React.CSSProperties;
}
export declare function BarSeries(props: BarSeriesProps): JSX.Element;
