import * as React from "react";

export interface CardProps {
  children?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned header slot — usually a Select or IconButton. */
  action?: React.ReactNode;
  /** Override interior padding. */
  padding?: number | string;
  /** "panel" = 18px radius outer container; "card" = 14px content block. */
  tone?: "card" | "panel" | "raised" | "inset";
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}
export declare function Card(props: CardProps): JSX.Element;
