import * as React from "react";

/** Breakdown row where the background fill encodes share. */
export interface MetricBarProps {
  label?: React.ReactNode;
  /** Pre-formatted figure on the right. */
  value?: React.ReactNode;
  /** 0–100; width of the tinted fill behind the row. */
  share?: number;
  /** Secondary figure before the value (e.g. "3.2%"). */
  meta?: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function MetricBar(props: MetricBarProps): React.JSX.Element;
