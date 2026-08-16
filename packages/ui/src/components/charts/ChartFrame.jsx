"use client";

import React from "react";

/** Card shell shared by every chart: title, right-hand controls, legend, plot area. */
export function ChartFrame({ title, subtitle, actions, legend, height, tone = "card", children, style }) {
  return (
    <section
      style={{
        display: "flex", flexDirection: "column", minWidth: 0,
        padding: "14px 16px 12px",
        background: tone === "panel" ? "var(--surface-panel)" : "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--edge-top)",
        ...style
      }}
    >
      {(title || actions) && (
        <header style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            {title && <span style={{ fontSize: "var(--size-body-sm)", fontWeight: "var(--wt-semibold)", color: "var(--text-primary)" }}>{title}</span>}
            {subtitle && <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{subtitle}</span>}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>{actions}</div>
        </header>
      )}
      <div style={{ flex: 1, minHeight: height, display: "flex", flexDirection: "column" }}>{children}</div>
      {legend && <div style={{ marginTop: 10 }}>{legend}</div>}
    </section>
  );
}
