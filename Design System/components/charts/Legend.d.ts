import * as React from "react";

export interface LegendItem {
  label: string;
  color?: string;
  /** "dot" (default) or "line" for line series. */
  shape?: "dot" | "line";
  /** Applies the --hatch texture to the swatch, matching hatched bars. */
  hatch?: boolean;
  /** Optional trailing figure, mono. */
  value?: React.ReactNode;
}

export interface LegendProps {
  items?: LegendItem[];
  compact?: boolean;
  style?: React.CSSProperties;
}
export declare function Legend(props: LegendProps): JSX.Element;
