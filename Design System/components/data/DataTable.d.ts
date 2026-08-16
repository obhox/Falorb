import * as React from "react";

export interface DataColumn {
  key: string;
  header?: React.ReactNode;
  /** CSS grid track, e.g. "1fr" or "110px". */
  width?: string;
  align?: "left" | "center" | "right";
  /** Mono + tabular figures. Use for every numeric column. */
  mono?: boolean;
  render?: (row: any) => React.ReactNode;
}

export interface DataTableProps {
  columns?: DataColumn[];
  rows?: any[];
  /** 30px rows instead of 38px. */
  dense?: boolean;
  onRowClick?: (row: any) => void;
  selectedId?: string | number;
  emptyState?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function DataTable(props: DataTableProps): JSX.Element;
