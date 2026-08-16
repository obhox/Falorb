import React from "react";

/** Frosted surface used for overlays that sit above data: tooltips, popovers, floating toolbars. */
export function GlassPanel({ children, heavy = false, radius = "var(--radius-panel)", padding = "var(--pad-panel)", style }) {
  return (
    <div
      style={{
        background: "var(--glass-bg)",
        border: "var(--glass-border)",
        borderRadius: radius,
        padding,
        backdropFilter: heavy ? "var(--glass-blur-heavy)" : "var(--glass-blur)",
        WebkitBackdropFilter: heavy ? "var(--glass-blur-heavy)" : "var(--glass-blur)",
        boxShadow: heavy ? "var(--shadow-4)" : "var(--shadow-3)",
        ...style
      }}
    >
      {children}
    </div>
  );
}
