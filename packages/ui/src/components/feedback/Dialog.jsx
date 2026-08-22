"use client";

import React from "react";

export function Dialog({ open = true, title, subtitle, children, footer, onClose, width = 480, style }) {
  if (!open) return null;
  return (
    <div
      style={{
        // Fixed (not absolute) so the overlay always fills the *viewport*,
        // not `<main>`'s content box — on mobile `.falorb-main` drops to
        // `height: auto` (see responsive.css), which would otherwise
        // collapse an absolutely-positioned overlay to the height of the
        // page content behind it instead of the screen.
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, boxSizing: "border-box",
        background: "rgba(5,6,7,.62)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)"
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: "92%",
          // Caps the dialog to the viewport so a tall form (e.g. the agent
          // "from scratch" fields) scrolls internally instead of overflowing
          // past the screen with no way to reach the footer.
          maxHeight: "100%",
          display: "flex", flexDirection: "column",
          background: "var(--glass-bg)", border: "var(--glass-border)",
          borderRadius: "var(--radius-panel)",
          backdropFilter: "var(--glass-blur-heavy)", WebkitBackdropFilter: "var(--glass-blur-heavy)",
          boxShadow: "var(--shadow-4)",
          animation: "falorb-dialog-in var(--dur-3) var(--ease-emphasis)",
          ...style
        }}
      >
        <style>{"@keyframes falorb-dialog-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}"}</style>
        {(title || subtitle) && (
          <header style={{ flex: "0 0 auto", padding: "18px 20px 0", display: "grid", gap: 3 }}>
            {title && <h3 style={{ margin: 0, fontSize: "var(--size-subtitle)", color: "var(--text-primary)", fontWeight: "var(--wt-semibold)", letterSpacing: "var(--ls-title)" }}>{title}</h3>}
            {subtitle && <p style={{ margin: 0, fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>{subtitle}</p>}
          </header>
        )}
        <div
          style={{
            flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain",
            padding: "16px 20px", fontSize: "var(--size-body-sm)", color: "var(--text-body)"
          }}
        >
          {children}
        </div>
        {footer && (
          <footer style={{ flex: "0 0 auto", display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 20px 18px" }}>{footer}</footer>
        )}
      </div>
    </div>
  );
}
