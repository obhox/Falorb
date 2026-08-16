import * as React from "react";

export interface TooltipRow { label: string; value: React.ReactNode; color?: string }

export interface TooltipProps {
  children?: React.ReactNode;
  /** Plain string, or the heading of a `rows` hover card. */
  label?: React.ReactNode;
  /** Series readout form — used as the chart hover card. */
  rows?: TooltipRow[];
  side?: "top" | "bottom" | "left" | "right";
  /** Force visibility (e.g. chart hover driven from outside). */
  open?: boolean;
  style?: React.CSSProperties;
}
export declare function Tooltip(props: TooltipProps): JSX.Element;
