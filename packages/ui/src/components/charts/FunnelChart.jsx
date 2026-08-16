"use client";

import React from "react";

/** Step conversion. steps: [{ label, value }] — first step is 100%. Drop-off is shown per step. */
export function FunnelChart({ steps = [], height, style }) {
  const first = steps[0]?.value || 1;
  return (
    <div style={{ display: "grid", gap: 6, flex: 1, alignContent: "start", minHeight: height, ...style }}>
      {steps.map((s, i) => {
        const pct = (s.value / first) * 100;
        const drop = i ? ((steps[i - 1].value - s.value) / steps[i - 1].value) * 100 : 0;
        return (
          <div key={s.label} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>{s.label}</span>
              {i > 0 && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)", color: "var(--signal-down)" }}>
                  −{drop.toFixed(1)}%
                </span>
              )}
              <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: "var(--size-body-sm)", color: "var(--text-primary)", fontWeight: "var(--wt-medium)", width: 68, textAlign: "right" }}>
                {s.value.toLocaleString()}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)", color: "var(--text-muted)", width: 44, textAlign: "right" }}>
                {pct.toFixed(1)}%
              </span>
            </div>
            <div style={{ height: 22, borderRadius: "var(--radius-2)", background: "var(--w-4)", backgroundImage: "var(--hatch)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${pct}%`, height: "100%", borderRadius: "var(--radius-2)",
                  background: i === 0 ? "var(--glacier-400)" : `color-mix(in oklab, var(--glacier-400) ${Math.max(100 - i * 16, 30)}%, var(--ink-600))`,
                  transition: "width var(--dur-4) var(--ease-emphasis)"
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
