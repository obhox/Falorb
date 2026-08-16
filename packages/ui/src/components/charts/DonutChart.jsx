"use client";

import React from "react";

/** Donut breakdown with a centred total and an optional right-hand value list. */
export function DonutChart({ segments = [], total, totalLabel = "Total", size = 148, thickness = 16, showList = true, style }) {
  const [hover, setHover] = React.useState(null);
  const sum = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flex: 1, minWidth: 0, ...style }}>
      <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={thickness} />
          {segments.map((s, i) => {
            const len = (s.value / sum) * c;
            const el = (
              <circle
                key={s.label}
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={s.color || `var(--series-${(i % 5) + 1})`}
                strokeWidth={hover === s.label ? thickness + 3 : thickness}
                strokeDasharray={`${Math.max(len - 1.5, 0)} ${c - Math.max(len - 1.5, 0)}`}
                strokeDashoffset={-offset}
                onMouseEnter={() => setHover(s.label)}
                onMouseLeave={() => setHover(null)}
                style={{ transition: "stroke-width var(--dur-2) var(--ease-out)", cursor: "default" }}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", gap: 1 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: 26, letterSpacing: "var(--ls-metric)", color: "var(--metric-fg)", lineHeight: 1 }}>
            {hover ? segments.find((s) => s.label === hover).value.toLocaleString() : total ?? sum.toLocaleString()}
          </span>
          <span style={{ fontSize: "var(--size-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-muted)" }}>
            {hover || totalLabel}
          </span>
        </div>
      </div>
      {showList && (
        <div style={{ flex: 1, display: "grid", gap: 7, minWidth: 0 }}>
          {segments.map((s, i) => (
            <div
              key={s.label}
              onMouseEnter={() => setHover(s.label)}
              onMouseLeave={() => setHover(null)}
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--size-body-sm)", color: hover === s.label ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              <span style={{ width: 7, height: 7, borderRadius: 999, background: s.color || `var(--series-${(i % 5) + 1})`, flex: "0 0 auto" }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", color: "var(--text-primary)" }}>
                {Math.round((s.value / sum) * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
