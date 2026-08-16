import * as React from "react";

/** Sliding-thumb switcher for granularity and ranges. */
export interface SegmentedControlProps {
  options?: string[];
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  fullWidth?: boolean;
  style?: React.CSSProperties;
}
export declare function SegmentedControl(props: SegmentedControlProps): React.JSX.Element;
