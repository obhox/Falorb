"use client";

import React from "react";

/** Filled area + line trend. Monotone by default; pass color for the highlighted series. */
export function Sparkline({ data = [], width, height = 32, color = "var(--series-1)", fill = true, strokeWidth = 1.4, style }) {
  const w = 100;
  const h = 100;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((d, i) => [
    (i / Math.max(data.length - 1, 1)) * w,
    h - ((d - min) / span) * (h - 8) - 4
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  // React.useId, not Math.random: the server and the client each render this
  // component once, and a random id would differ between the two passes and
  // break hydration on the gradient reference.
  const gid = "sl" + React.useId().replace(/:/g, "");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: width || "100%", height, overflow: "visible", ...style }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
