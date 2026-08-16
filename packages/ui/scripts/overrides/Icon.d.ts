import * as React from "react";

/** Lucide glyph wrapper, resolved from the bundled `lucide-react` set — no CDN script, renders on the server. */
export interface IconProps {
  /** Lucide icon name, kebab-case, e.g. "activity", "chevron-down". */
  name: string;
  /** Pixel box. 14 in dense tables, 16 default, 18–20 in nav. */
  size?: number;
  /** Falorb uses 1.5 everywhere. */
  strokeWidth?: number;
  color?: string;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): React.JSX.Element;
