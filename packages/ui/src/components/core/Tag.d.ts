import * as React from "react";

export interface TagProps {
  children?: React.ReactNode;
  /** Shows an × affordance. */
  onRemove?: () => void;
  icon?: React.ReactNode;
  /** Selected filter state (glacier tint). */
  active?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function Tag(props: TagProps): React.JSX.Element;
