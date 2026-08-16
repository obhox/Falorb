import * as React from "react";

export interface StackedBarsProps {
  /** [{ label, values }] — values align with `series` order, bottom-up. */
  data?: { label: string; values: number[] }[];
  series?: { name: string; color?: string }[];
  height?: number;
  showAxis?: boolean;
  onSelect?: (label: string) => void;
  selected?: string;
  style?: React.CSSProperties;
}
export declare function StackedBars(props: StackedBarsProps): JSX.Element;
