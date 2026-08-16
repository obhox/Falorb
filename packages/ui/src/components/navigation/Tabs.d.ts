import * as React from "react";

export interface TabItem { value: string; label: React.ReactNode; count?: number | string }

/**
 * Underline tabs for in-page views.
 * @startingPoint section="Navigation" subtitle="Tabs, SegmentedControl, SidebarNav" viewport="700x260"
 */
export interface TabsProps {
  /** Strings, or objects with an optional trailing count. */
  tabs?: (string | TabItem)[];
  value?: string;
  onChange?: (value: string) => void;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}
export declare function Tabs(props: TabsProps): React.JSX.Element;
