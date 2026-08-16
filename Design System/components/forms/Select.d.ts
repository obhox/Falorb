import * as React from "react";

/** Compact dropdown; menu is a glass popover. */
export interface SelectProps {
  value?: string;
  options?: string[];
  onChange?: (value: string) => void;
  size?: "sm" | "md" | "lg";
  /** "bare" is the borderless inline header filter ("All properties ⌄"). */
  variant?: "control" | "bare";
  label?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function Select(props: SelectProps): JSX.Element;
