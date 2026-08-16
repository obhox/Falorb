import * as React from "react";

export interface SidebarItem { value: string; label: React.ReactNode; icon?: React.ReactNode; meta?: React.ReactNode }
export interface SidebarSection { label?: string; items: SidebarItem[] }

export interface SidebarNavProps {
  sections?: SidebarSection[];
  value?: string;
  onChange?: (value: string) => void;
  /** Pinned bottom slot — account row, version, storage meter. */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function SidebarNav(props: SidebarNavProps): JSX.Element;
