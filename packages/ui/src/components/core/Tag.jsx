"use client";

import React from "react";

export function Tag({ children, onRemove, icon, active = false, onClick, style }) {
  const [hover, setHover] = React.useState(false);
  const interactive = !!onClick;
  return (
    <span
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minHeight: 24,
        whiteSpace: "nowrap",
        padding: onRemove ? "0 4px 0 9px" : "0 9px",
        borderRadius: "var(--radius-pill)",
        background: active ? "var(--surface-selected)" : hover && interactive ? "var(--control-bg-hover)" : "var(--control-bg)",
        border: `1px solid ${active ? "rgba(125,211,252,.28)" : "var(--control-border)"}`,
        color: active ? "var(--glacier-200)" : "var(--text-body)",
        fontSize: "var(--size-label)",
        fontWeight: "var(--wt-medium)",
        lineHeight: 1,
        cursor: interactive ? "pointer" : "default",
        transition: "background var(--dur-1) var(--ease-out)",
        ...style
      }}
    >
      {icon}
      {children}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Remove"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 16, marginLeft: 1, padding: 0,
            border: "none", borderRadius: 999, background: "transparent",
            color: "var(--text-muted)", cursor: "pointer", fontSize: 12, lineHeight: 1
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
