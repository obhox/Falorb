import * as React from "react";

export interface RetentionCohort {
  label: string;
  size: number;
  /** Percentages for period 0..n; omit trailing periods that haven't happened. */
  values: (number | null)[];
}

export interface RetentionMatrixProps {
  cohorts?: RetentionCohort[];
  /** Column prefix source — "Week" renders W0, W1… Default "Week". */
  periodLabel?: string;
  cellWidth?: number;
  style?: React.CSSProperties;
}
export declare function RetentionMatrix(props: RetentionMatrixProps): JSX.Element;
