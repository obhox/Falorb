"use client";

import React from "react";

/** Horizontal share bar used in breakdown lists (top pages, referrers, countries). */
export function MetricBar({ label, value, share, meta, icon, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: 10,
        height: "var(--row-height)", padding: "0 10px",
        borderRadius: "var(--radius-2)", overflow: "hidden",
        cursor: onClick ? "pointer" : "default", ...style
      }}
    >
      <span
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.min(share, 100)}%`,
          background: hover ? "rgba(125,211,252,.16)" : "var(--w-4)",
          borderRight: "1px solid var(--w-8)",
          transition: "background var(--dur-1) var(--ease-out), width var(--dur-4) var(--ease-emphasis)"
        }}
      />
      {icon && <span style={{ position: "relative", display: "inline-flex", color: "var(--text-muted)" }}>{icon}</span>}
      <span
        style={{
          position: "relative", flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontSize: "var(--size-body-sm)", color: "var(--text-body)"
        }}
      >
        {label}
      </span>
      {meta && <span style={{ position: "relative", fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{meta}</span>}
      <span
        style={{
          position: "relative", fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)",
          fontSize: "var(--size-body-sm)", color: "var(--text-primary)", fontWeight: "var(--wt-medium)"
        }}
      >
        {value}
      </span>
    </div>
  );
}
