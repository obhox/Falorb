"use client";

import React from "react";

/**
 * Cohort retention triangle. cohorts: [{ label, size, values: number[] }] where values are
 * percentages for week/day 0..n. Cells fade with intensity; empty future cells stay blank.
 */
export function RetentionMatrix({ cohorts = [], periodLabel = "Week", cellWidth = 52, style }) {
  const width = Math.max(...cohorts.map((c) => c.values.length), 1);
  return (
    <div style={{ overflowX: "auto", flex: 1, ...style }}>
      <div style={{ display: "grid", gap: 3, gridTemplateColumns: `minmax(96px,1.2fr) 60px repeat(${width}, minmax(34px,${cellWidth}px))` }}>
        <span style={{ fontSize: "var(--size-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)" }}>Cohort</span>
        <span style={{ fontSize: "var(--size-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)", textAlign: "right" }}>People</span>
        {Array.from({ length: width }, (_, i) => (
          <span key={i} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)", color: "var(--text-muted)", textAlign: "center" }}>
            {periodLabel[0]}{i}
          </span>
        ))}
        {cohorts.map((c) => (
          <React.Fragment key={c.label}>
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-body)", display: "flex", alignItems: "center" }}>{c.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: "var(--size-label)", color: "var(--text-primary)", textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              {c.size.toLocaleString()}
            </span>
            {Array.from({ length: width }, (_, i) => {
              const v = c.values[i];
              if (v === undefined || v === null) return <span key={i} />;
              const a = 0.08 + (v / 100) * 0.72;
              return (
                <span
                  key={i}
                  style={{
                    height: 26, borderRadius: 3,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: `rgba(125,211,252,${a.toFixed(3)})`,
                    color: v > 55 ? "var(--ink-1000)" : "var(--text-primary)",
                    fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: "var(--size-micro)"
                  }}
                >
                  {v}%
                </span>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
