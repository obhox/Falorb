import React from "react";

/** +/- change chip. The only place colour carries meaning in a Falorb metric block. */
export function DeltaPill({ value, invert = false, size = "md", showArrow = true, style }) {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  const up = Number.isFinite(num) ? num >= 0 : String(value).trim().startsWith("+");
  const good = invert ? !up : up;
  const text = typeof value === "number" ? `${up ? "+" : ""}${value}%` : value;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        height: size === "sm" ? 18 : 22, padding: size === "sm" ? "0 6px" : "0 8px",
        borderRadius: "var(--radius-2)",
        background: good ? "var(--signal-up-dim)" : "var(--signal-down-dim)",
        color: good ? "var(--signal-up)" : "var(--signal-down)",
        fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)",
        fontSize: size === "sm" ? "var(--size-micro)" : "var(--size-label)",
        fontWeight: "var(--wt-medium)", lineHeight: 1, whiteSpace: "nowrap",
        ...style
      }}
    >
      {showArrow && (
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ transform: up ? "none" : "rotate(180deg)" }}>
          <path d="M4.5 7.5V1.5M4.5 1.5L1.8 4.2M4.5 1.5l2.7 2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      {text}
    </span>
  );
}
