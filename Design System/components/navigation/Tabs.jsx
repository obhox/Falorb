import React from "react";

/** Underline tabs — the primary in-page view switcher (Summary / Sessions / People …). */
export function Tabs({ tabs = [], value, onChange, size = "md", style }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "stretch", gap: size === "sm" ? 16 : 22,
        borderBottom: "1px solid var(--border-subtle)", ...style
      }}
    >
      {tabs.map((t) => {
        const key = typeof t === "string" ? t : t.value;
        const label = typeof t === "string" ? t : t.label;
        const count = typeof t === "string" ? undefined : t.count;
        const on = key === value;
        return (
          <button
            key={key}
            onClick={() => onChange && onChange(key)}
            style={{
              position: "relative", display: "inline-flex", alignItems: "center", gap: 6,
              padding: size === "sm" ? "0 0 9px" : "0 0 12px",
              border: "none", background: "transparent", cursor: "pointer",
              color: on ? "var(--text-primary)" : "var(--text-muted)",
              fontFamily: "var(--font-sans)",
              fontSize: size === "sm" ? "var(--size-body-sm)" : "var(--size-body)",
              fontWeight: on ? "var(--wt-semibold)" : "var(--wt-medium)",
              letterSpacing: "var(--ls-body)",
              transition: "color var(--dur-1) var(--ease-out)"
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = "var(--text-body)"; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {label}
            {count !== undefined && (
              <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                {count}
              </span>
            )}
            <span
              style={{
                position: "absolute", left: 0, right: 0, bottom: -1, height: 1.5,
                background: on ? "var(--ink-50)" : "transparent",
                transition: "background var(--dur-3) var(--ease-out)"
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
