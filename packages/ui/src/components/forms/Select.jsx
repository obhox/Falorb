"use client";

import React from "react";

/** Compact dropdown. Bare variant is the inline "All accounts ⌄" filter used in page headers. */
export function Select({ value, options = [], onChange, size = "md", variant = "control", label, style }) {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const h = size === "sm" ? 28 : size === "lg" ? 42 : 34;
  const bare = variant === "bare";
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-grid", gap: 6, ...style }}>
      {label && <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)" }}>{label}</span>}
      <button
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          height: h, padding: bare ? "0 2px" : "0 10px",
          borderRadius: "var(--radius-control)",
          background: bare ? "transparent" : hover ? "var(--control-bg-hover)" : "var(--control-bg)",
          border: bare ? "1px solid transparent" : "1px solid var(--control-border)",
          color: bare && !hover ? "var(--text-body)" : "var(--text-primary)",
          fontFamily: "var(--font-sans)", fontSize: "var(--size-body-sm)", fontWeight: "var(--wt-medium)",
          cursor: "pointer", whiteSpace: "nowrap",
          transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)"
        }}
      >
        {value}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur-2) var(--ease-out)" }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: `calc(100% + 6px)`, left: 0, zIndex: 40, minWidth: 168,
            padding: 4, borderRadius: "var(--radius-card)",
            background: "var(--glass-bg)", border: "var(--glass-border)",
            backdropFilter: "var(--glass-blur-heavy)", WebkitBackdropFilter: "var(--glass-blur-heavy)",
            boxShadow: "var(--shadow-4)"
          }}
        >
          {options.map((o) => (
            <div
              key={o}
              onClick={() => { onChange && onChange(o); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                padding: "7px 9px", borderRadius: "var(--radius-2)",
                background: o === value ? "var(--surface-selected)" : "transparent",
                color: o === value ? "var(--glacier-200)" : "var(--text-body)",
                fontSize: "var(--size-body-sm)", cursor: "pointer"
              }}
              onMouseEnter={(e) => { if (o !== value) e.currentTarget.style.background = "var(--surface-hover)"; }}
              onMouseLeave={(e) => { if (o !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o}
              {o === value && <span style={{ fontSize: 11 }}>✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
