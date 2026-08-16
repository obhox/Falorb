import * as React from "react";

/**
 * Falorb button. Primary is a white pill-less rect on graphite; `accent` (glacier)
 * is reserved for one call-to-action per view.
 * @startingPoint section="Core" subtitle="Button, IconButton, Badge, Tag, Card, GlassPanel" viewport="700x220"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  /** Visual weight. Default "secondary". */
  variant?: "primary" | "secondary" | "glass" | "ghost" | "accent" | "danger";
  /** 28 / 34 / 42px tall. Default "md". */
  size?: "sm" | "md" | "lg";
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Render as another element, e.g. "a". Default "button". */
  as?: keyof JSX.IntrinsicElements;
  style?: React.CSSProperties;
}
export declare function Button(props: ButtonProps): React.JSX.Element;
