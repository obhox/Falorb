import * as React from "react";

/**
 * Text field on an inset (darker-than-surface) well.
 * @startingPoint section="Forms" subtitle="Input, Select, Checkbox, Switch" viewport="700x230"
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  label?: React.ReactNode;
  /** Helper or error text under the field. */
  hint?: React.ReactNode;
  iconLeft?: React.ReactNode;
  /** Trailing unit or shortcut hint, mono. */
  suffix?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  /** Mono + tabular figures — use for IDs, domains, numbers. */
  mono?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}
export declare function Input(props: InputProps): JSX.Element;
