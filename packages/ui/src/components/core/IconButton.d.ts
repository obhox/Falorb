import * as React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Glyph element, normally <Icon name="…" />. */
  icon?: React.ReactNode;
  /** Required for a11y — also used as the title tooltip. */
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "solid" | "glass";
  /** Sticky pressed look for toggles (filters open, view mode). */
  active?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}
export declare function IconButton(props: IconButtonProps): React.JSX.Element;
