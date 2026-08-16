import * as React from "react";

export interface GlassPanelProps {
  children?: React.ReactNode;
  /** 36px blur + deeper shadow for modals and command palettes. */
  heavy?: boolean;
  radius?: string;
  padding?: string | number;
  style?: React.CSSProperties;
}
export declare function GlassPanel(props: GlassPanelProps): JSX.Element;
