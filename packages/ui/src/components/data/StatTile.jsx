"use client";

import React from "react";
import { DeltaPill } from "./DeltaPill.jsx";
import { Sparkline } from "./Sparkline.jsx";

/** The metric primitive: micro-label, oversized figure, delta, optional trend. */
export function StatTile({ label, value, unit, delta, invertDelta = false, series, footnote, size = "md", bordered = true, style }) {
  const fs = size === "lg" ? "var(--size-metric-xl)" : size === "sm" ? "var(--size-metric-md)" : "var(--size-metric-lg)";
  return (
    <div
      style={{
        display: "grid", gap: 8, padding: bordered ? "14px 16px" : 0,
        borderRadius: "var(--radius-card)",
        background: bordered ? "var(--surface-card)" : "transparent",
        border: bordered ? "1px solid var(--border-subtle)" : "none",
        boxShadow: bordered ? "var(--edge-top)" : "none",
        ...style
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span
          style={{
            fontSize: "var(--size-micro)", textTransform: "uppercase",
            letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: "var(--wt-medium)"
          }}
        >
          {label}
        </span>
        {delta !== undefined && <DeltaPill value={delta} invert={invertDelta} size="sm" />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)",
            fontSize: fs, fontWeight: "var(--wt-medium)",
            letterSpacing: "var(--ls-metric)", lineHeight: 1, color: "var(--metric-fg)"
          }}
        >
          {value}
        </span>
        {unit && <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>{unit}</span>}
      </div>
      {series && <Sparkline data={series} height={28} />}
      {footnote && <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{footnote}</span>}
    </div>
  );
}
