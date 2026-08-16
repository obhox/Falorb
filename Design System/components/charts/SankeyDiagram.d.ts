import * as React from "react";

export interface SankeyNode {
  id: string;
  label: string;
  /** 0-based column index; left to right. */
  column: number;
  color?: string;
}
export interface SankeyLink { from: string; to: string; value: number }

export interface SankeyDiagramProps {
  nodes?: SankeyNode[];
  links?: SankeyLink[];
  height?: number;
  nodeWidth?: number;
  /** Vertical gap between nodes in a column. */
  nodeGap?: number;
  format?: (v: number) => string;
  style?: React.CSSProperties;
}
export declare function SankeyDiagram(props: SankeyDiagramProps): JSX.Element;
