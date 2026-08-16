import React from "react";

/** Range / granularity switcher. Sliding glass thumb, never a hard jump. */
export function SegmentedControl({ options = [], value, onChange, size = "md", fullWidth = false, style }) {
  const h = size === "sm" ? 26 : 32;
  const i = Math.max(0, options.indexOf(value));
  return (
    <div
      style={{
        position: "relative", display: fullWidth ? "grid" : "inline-grid",
        gridAutoFlow: "column", gridAutoColumns: "1fr",
        width: fullWidth ? "100%" : undefined,
        padding: 2, height: h + 4,
        borderRadius: "var(--radius-control)",
        background: "var(--surface-inset)", border: "1px solid var(--control-border)",
        boxShadow: "var(--edge-top)", ...style
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, bottom: 2,
          left: `calc(${(i * 100) / options.length}% + 2px)`,
          width: `calc(${100 / options.length}% - 4px)`,
          borderRadius: "var(--radius-3)",
          background: "var(--w-8)", border: "1px solid var(--w-8)",
          backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)",
          transition: "left var(--dur-3) var(--ease-emphasis)"
        }}
      />
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            onClick={() => onChange && onChange(o)}
            style={{
              position: "relative", zIndex: 1, height: h, padding: "0 12px",
              border: "none", background: "transparent", cursor: "pointer",
              color: on ? "var(--text-primary)" : "var(--text-muted)",
              fontFamily: "var(--font-sans)", fontSize: "var(--size-label)",
              fontWeight: on ? "var(--wt-semibold)" : "var(--wt-medium)",
              whiteSpace: "nowrap",
              transition: "color var(--dur-2) var(--ease-out)"
            }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}
