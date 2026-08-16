"use client";

import React from "react";

const TONES = {
  neutral: { bg: "var(--w-6)", fg: "var(--text-secondary)", bd: "var(--w-8)" },
  accent: { bg: "rgba(125,211,252,.12)", fg: "var(--glacier-300)", bd: "rgba(125,211,252,.22)" },
  up: { bg: "var(--signal-up-dim)", fg: "var(--signal-up)", bd: "rgba(95,208,138,.22)" },
  down: { bg: "var(--signal-down-dim)", fg: "var(--signal-down)", bd: "rgba(242,116,139,.22)" },
  warn: { bg: "var(--signal-warn-dim)", fg: "var(--signal-warn)", bd: "rgba(233,184,114,.22)" },
  solid: { bg: "var(--ink-50)", fg: "var(--ink-1000)", bd: "transparent" }
};

export function Badge({ children, tone = "neutral", mono = false, dot = false, style }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 20,
        padding: "0 7px",
        borderRadius: "var(--radius-2)",
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontFeatureSettings: mono ? "var(--tnum)" : undefined,
        fontSize: "var(--size-micro)",
        fontWeight: "var(--wt-medium)",
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style
      }}
    >
      {dot && (
        <span style={{ width: 5, height: 5, borderRadius: 999, background: t.fg, flex: "0 0 auto" }} />
      )}
      {children}
    </span>
  );
}
