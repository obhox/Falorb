import * as React from "react";

/** No-data state. Falorb explains the cause and the next action, never just "No data". */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  /** Tighter padding for inside a card or table. */
  dense?: boolean;
  style?: React.CSSProperties;
}
export declare function EmptyState(props: EmptyStateProps): JSX.Element;
