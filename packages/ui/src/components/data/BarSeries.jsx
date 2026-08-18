"use client";

import React from "react";

/**
 * Column chart with Falorb's hatch-filled inactive bars and a solid highlight on the
 * hovered/selected column. Values are plain numbers; labels sit under the axis.
 */
export function BarSeries({ data = [], height = 180, selected, onSelect, color = "var(--series-1)", showAxis = true, style }) {
  const [hover, setHover] = React.useState(null);
  const max = Math.max(...data.map((d) => d.value), 1);
  const active = hover ?? selected;
  return (
    <div style={{ display: "grid", gap: 8, ...style }}>
      <div style={{ position: "relative", height, display: "flex", alignItems: "flex-end", gap: 6, minWidth: 0 }}>
        {showAxis && [0, 0.5, 1].map((t) => (
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
              style={{ position: "relative", flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end", cursor: onSelect ? "pointer" : "default" }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${Math.max((d.value / max) * 100, 2)}%`,
                  borderRadius: "var(--radius-2)",
                  background: on ? color : "var(--w-4)",
                  backgroundImage: on ? undefined : "var(--hatch)",
                  borderTop: on ? "none" : `1.5px solid ${color}`,
                  transition: "background var(--dur-2) var(--ease-out), height var(--dur-4) var(--ease-emphasis)"
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
        {data.map((d) => (
          <span
            key={d.label}
            title={d.label}
            style={{
              flex: 1, minWidth: 0, textAlign: "center",
              fontSize: "var(--size-micro)",
              fontFamily: "var(--font-mono)",
              color: active === d.label ? "var(--text-primary)" : "var(--text-muted)",
              fontWeight: active === d.label ? "var(--wt-medium)" : "var(--wt-regular)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              transition: "color var(--dur-1) var(--ease-out)"
            }}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
