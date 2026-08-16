"use client";

import React from "react";

/**
 * Multi-series line / area chart with a y-axis, hairline grid, and a hover crosshair.
 * Series: [{ name, color, data: number[], fill?: boolean, dashed?: boolean }]
 */
export function LineChart({
  series = [],
  labels = [],
  height = 200,
  yTicks = 4,
  format = (v) => v.toLocaleString(),
  onHover,
  showGrid = true,
  style
}) {
  const [idx, setIdx] = React.useState(null);
  const all = series.flatMap((s) => s.data);
  const max = Math.max(...all, 1);
  const min = 0;
  const span = max - min || 1;
  const n = Math.max(...series.map((s) => s.data.length), 1);
  // Stable across server and client render: a random id differs between
  // the two passes and breaks hydration on the url(#…) reference.
  const uid = "lc" + React.useId().replace(/:/g, "");
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => max - (span / yTicks) * i);

  const path = (data, close) => {
    const pts = data.map((d, i) => [(i / Math.max(n - 1, 1)) * 100, 100 - ((d - min) / span) * 100]);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
    return close ? `${line} L100 100 L0 100 Z` : line;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, ...style }}>
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: height }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: "0 0 auto", paddingBottom: 1 }}>
          {ticks.map((t, i) => (
            <span key={i} style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: 1, transform: "translateY(-3px)" }}>
              {format(Math.round(t))}
            </span>
          ))}
        </div>
        <div
          style={{ position: "relative", flex: 1, minWidth: 0 }}
          onMouseLeave={() => { setIdx(null); onHover && onHover(null); }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
            const c = Math.max(0, Math.min(n - 1, i));
            setIdx(c); onHover && onHover(c);
          }}
        >
          {showGrid && ticks.map((t, i) => (
            <span key={i} style={{ position: "absolute", left: 0, right: 0, top: `${(i / yTicks) * 100}%`, height: 1, background: "var(--grid-line)" }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            <defs>
              {series.map((s, si) => (
                <linearGradient key={si} id={`${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color || "var(--series-1)"} stopOpacity="0.20" />
                  <stop offset="100%" stopColor={s.color || "var(--series-1)"} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {series.map((s, si) => s.fill && <path key={"f" + si} d={path(s.data, true)} fill={`url(#${uid}-${si})`} />)}
            {series.map((s, si) => (
              <path
                key={"l" + si}
                d={path(s.data)}
                fill="none"
                stroke={s.color || "var(--series-1)"}
                strokeWidth={1.6}
                strokeDasharray={s.dashed ? "3 3" : undefined}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </svg>
          {idx !== null && (
            <>
              <span style={{ position: "absolute", top: 0, bottom: 0, left: `${(idx / Math.max(n - 1, 1)) * 100}%`, width: 1, background: "var(--w-16)" }} />
              {series.map((s, si) => (
                <span
                  key={si}
                  style={{
                    position: "absolute",
                    left: `${(idx / Math.max(n - 1, 1)) * 100}%`,
                    top: `${100 - ((s.data[idx] - min) / span) * 100}%`,
                    width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5,
                    borderRadius: 999, background: s.color || "var(--series-1)",
                    boxShadow: "0 0 0 3px var(--dot-halo)"
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>
      {labels.length > 0 && (
        <div style={{ display: "flex", marginTop: 7, paddingLeft: 34 }}>
          {labels.map((l, i) => (
            <span
              key={i}
              style={{
                flex: 1, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)",
                color: idx === i ? "var(--text-primary)" : "var(--text-muted)"
              }}
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
