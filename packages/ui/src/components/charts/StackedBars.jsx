"use client";

import React from "react";

/**
 * Stacked column chart. data: [{ label, values: number[] }], series: [{ name, color }].
 * Unhovered columns keep the graphite ramp; the hovered column brightens its top segment.
 */
export function StackedBars({ data = [], series = [], height = 200, showAxis = true, onSelect, selected, style }) {
  const [hover, setHover] = React.useState(null);
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const active = hover ?? selected;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, ...style }}>
      <div style={{ position: "relative", flex: 1, minHeight: height, display: "flex", alignItems: "flex-end", gap: 5 }}>
        {showAxis && [0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span key={t} style={{ position: "absolute", left: 0, right: 0, bottom: `${t * 100}%`, height: 1, background: "var(--grid-line)" }} />
        ))}
        {data.map((d, i) => {
          const on = active === d.label;
          return (
            <div
              key={d.label}
              onMouseEnter={() => setHover(d.label)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect && onSelect(d.label)}
              style={{
                position: "relative", flex: 1, height: `${(totals[i] / max) * 100}%`,
                display: "flex", flexDirection: "column-reverse",
                borderRadius: "var(--radius-2)", overflow: "hidden",
                cursor: onSelect ? "pointer" : "default",
                opacity: active && !on ? 0.55 : 1,
                transition: "opacity var(--dur-2) var(--ease-out)"
              }}
            >
              {d.values.map((v, si) => (
                <span
                  key={si}
                  style={{
                    height: `${(v / (totals[i] || 1)) * 100}%`,
                    background: series[si]?.color || `var(--series-${(si % 5) + 1})`,
                    borderTop: si ? "1px solid rgba(9,9,9,.5)" : "none"
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 5, marginTop: 7 }}>
        {data.map((d) => (
          <span
            key={d.label}
            style={{
              flex: 1, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)",
              color: active === d.label ? "var(--text-primary)" : "var(--text-muted)"
            }}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
