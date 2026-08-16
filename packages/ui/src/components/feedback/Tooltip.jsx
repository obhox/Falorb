"use client";

import React from "react";

/** Glass tooltip. Also the chart hover card — pass `rows` for the label/value list form. */
export function Tooltip({ children, label, rows, side = "top", open, style }) {
  const [hover, setHover] = React.useState(false);
  const show = open ?? hover;
  const pos =
    side === "bottom" ? { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" } :
    side === "left" ? { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" } :
    side === "right" ? { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" } :
    { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" };
  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      <span
        style={{
          position: "absolute", zIndex: 60, ...pos,
          minWidth: rows ? 196 : undefined,
          padding: rows ? "10px 12px" : "6px 9px",
          borderRadius: rows ? "var(--radius-card)" : "var(--radius-2)",
          background: "var(--glass-bg)", border: "var(--glass-border)",
          backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)",
          boxShadow: "var(--shadow-3)",
          color: "var(--text-primary)", fontSize: "var(--size-label)",
          whiteSpace: rows ? "normal" : "nowrap",
          opacity: show ? 1 : 0,
          pointerEvents: "none",
          transition: "opacity var(--dur-2) var(--ease-out)",
          ...style
        }}
      >
        {rows ? (
          <span style={{ display: "grid", gap: 7 }}>
            {label && (
              <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{label}</span>
            )}
            {rows.map((r) => (
              <span key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-body)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: r.color || "var(--series-1)" }} />
                  {r.label}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", color: "var(--text-primary)", fontWeight: "var(--wt-medium)" }}>
                  {r.value}
                </span>
              </span>
            ))}
          </span>
        ) : label}
      </span>
    </span>
  );
}
