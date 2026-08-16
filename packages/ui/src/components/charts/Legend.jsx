"use client";

import React from "react";

export function Legend({ items = [], compact = false, style }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: compact ? 12 : 16, ...style }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--size-micro)", color: "var(--text-secondary)" }}>
          <span
            style={{
              width: it.shape === "line" ? 12 : 7,
              height: it.shape === "line" ? 2 : 7,
              borderRadius: it.shape === "line" ? 2 : 999,
              background: it.color || "var(--series-1)",
              backgroundImage: it.hatch ? "var(--hatch)" : undefined,
              flex: "0 0 auto"
            }}
          />
          {it.label}
          {it.value !== undefined && (
            <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", color: "var(--text-primary)" }}>{it.value}</span>
          )}
        </span>
      ))}
    </div>
  );
}
