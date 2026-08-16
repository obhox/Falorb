import * as React from "react";

/** Signed change chip in up/down signal colour. */
export interface DeltaPillProps {
  /** Number (signed, rendered as %) or a pre-formatted string like "+1.2k". */
  value?: number | string;
  /** True when a decrease is good. */
  invert?: boolean;
  size?: "sm" | "md";
  showArrow?: boolean;
  style?: React.CSSProperties;
}
export declare function DeltaPill(props: DeltaPillProps): React.JSX.Element;
