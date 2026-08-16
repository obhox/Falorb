"use client";

import React from "react";
import { createPortal } from "react-dom";

/**
 * Compact dropdown; menu is a glass popover.
 *
 * The menu is rendered into a portal on `document.body` rather than as a
 * positioned child of the trigger. As a child it was clipped and covered in
 * ordinary use: `Card` sets `overflow: hidden` to clip its content to the
 * corner radius, panel bodies scroll with `overflow-y: auto`, and either one
 * cuts an absolutely-positioned menu off at its edge. A z-index cannot fix
 * that — clipping happens regardless of stacking order — so the menu has to
 * leave the subtree entirely.
 *
 * Being in a portal means the menu no longer moves with its trigger, so it
 * closes on scroll and resize rather than being left floating beside nothing.
 */
export function Select({ value, options = [], onChange, size = "md", variant = "control", label, style }) {
  const [open, setOpen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const [rect, setRect] = React.useState(null);
  const ref = React.useRef(null);
  const menuRef = React.useRef(null);

  const h = size === "sm" ? 28 : size === "lg" ? 42 : 34;
  const bare = variant === "bare";

  const place = React.useCallback(() => {
    const trigger = ref.current;
    if (!trigger) return;
    setRect(trigger.getBoundingClientRect());
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  React.useEffect(() => {
    if (!open) return;

    const away = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    // Capture phase: a scroll inside any ancestor container counts, and those
    // do not bubble.
    const dismiss = () => setOpen(false);

    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);

    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const menu = open && rect && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={(() => {
            const width = Math.max(rect.width, 168);
            const estimated = Math.min(options.length, 8) * 34 + 8;
            // Flip above when there is not room below, so the last option in a
            // long list is not pinned off-screen.
            const below = window.innerHeight - rect.bottom;
            const flip = below < estimated + 12 && rect.top > below;

            return {
              position: "fixed",
              top: flip ? undefined : rect.bottom + 6,
              bottom: flip ? window.innerHeight - rect.top + 6 : undefined,
              // Keep the menu inside the viewport when the trigger sits near
              // the right edge.
              left: Math.min(rect.left, window.innerWidth - width - 8),
              width,
              maxHeight: "min(320px, 60vh)",
              overflowY: "auto",
              zIndex: 1000,
              padding: 4,
              borderRadius: "var(--radius-card)",
              background: "var(--glass-bg)",
              border: "var(--glass-border)",
              backdropFilter: "var(--glass-blur-heavy)",
              WebkitBackdropFilter: "var(--glass-blur-heavy)",
              boxShadow: "var(--shadow-4)"
            };
          })()}
        >
          {options.map((o) => (
            <div
              key={o}
              role="option"
              aria-selected={o === value}
              onClick={() => { onChange && onChange(o); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                padding: "7px 9px", borderRadius: "var(--radius-2)",
                background: o === value ? "var(--surface-selected)" : "transparent",
                color: o === value ? "var(--text-accent)" : "var(--text-body)",
                fontSize: "var(--size-body-sm)", cursor: "pointer",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
              }}
              onMouseEnter={(e) => { if (o !== value) e.currentTarget.style.background = "var(--surface-hover)"; }}
              onMouseLeave={(e) => { if (o !== value) e.currentTarget.style.background = "transparent"; }}
            >
              {o}
              {o === value && <span aria-hidden="true">✓</span>}
            </div>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div style={{ position: "relative", display: "inline-grid", gap: 6, ...style }}>
      {label && <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)" }}>{label}</span>}
      <button
        ref={ref}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 6,
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
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flex: "0 0 auto", opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur-2) var(--ease-out)" }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {menu}
    </div>
  );
}
