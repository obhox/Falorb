"use client";

import React from "react";

export function Card({ children, title, subtitle, action, padding, tone = "card", style, bodyStyle }) {
  const bg =
    tone === "panel" ? "var(--surface-panel)" :
    tone === "raised" ? "var(--surface-raised)" :
    tone === "inset" ? "var(--surface-inset)" : "var(--surface-card)";
  const pad = padding ?? (tone === "panel" ? "var(--pad-panel)" : "var(--pad-card)");
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        background: bg,
        border: "1px solid var(--border-subtle)",
        borderRadius: tone === "panel" ? "var(--radius-panel)" : "var(--radius-card)",
        boxShadow: "var(--shadow-2)",
        overflow: "hidden",
        ...style
      }}
    >
      {(title || action) && (
        <header
          style={{
            display: "flex", alignItems: "flex-start", justifyContent: "space-between",
            gap: 12, padding: `${typeof pad === "number" ? pad + "px" : pad} ${typeof pad === "number" ? pad + "px" : pad} 0`
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            {title && (
              <h3 style={{ fontSize: "var(--size-body)", fontWeight: "var(--wt-semibold)", color: "var(--text-primary)", letterSpacing: "var(--ls-body)" }}>
                {title}
              </h3>
            )}
            {subtitle && (
              <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>{subtitle}</span>
            )}
          </div>
          {action}
        </header>
      )}
      <div style={{ padding: pad, ...bodyStyle }}>{children}</div>
    </section>
  );
}
