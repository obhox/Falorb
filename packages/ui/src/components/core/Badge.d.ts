import * as React from "react";

export interface BadgeProps {
  children?: React.ReactNode;
  /** Semantic tone. "up"/"down" are for deltas only. */
  tone?: "neutral" | "accent" | "up" | "down" | "warn" | "solid";
  /** Tabular mono figures — use for any numeric badge. */
  mono?: boolean;
  /** Leading status dot. */
  dot?: boolean;
  style?: React.CSSProperties;
}
export declare function Badge(props: BadgeProps): React.JSX.Element;
