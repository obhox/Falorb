"use client";

import React from "react";

export function Dialog({ open = true, title, subtitle, children, footer, onClose, width = 480, style }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(5,6,7,.62)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)"
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: "92%",
          background: "var(--glass-bg)", border: "var(--glass-border)",
          borderRadius: "var(--radius-panel)",
          backdropFilter: "var(--glass-blur-heavy)", WebkitBackdropFilter: "var(--glass-blur-heavy)",
          boxShadow: "var(--shadow-4)",
          animation: "falorb-dialog-in var(--dur-3) var(--ease-emphasis)",
          ...style
        }}
      >
        <style>{"@keyframes falorb-dialog-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}"}</style>
        <header style={{ padding: "18px 20px 0", display: "grid", gap: 3 }}>
          {title && <h3 style={{ margin: 0, fontSize: "var(--size-subtitle)", color: "var(--text-primary)", fontWeight: "var(--wt-semibold)", letterSpacing: "var(--ls-title)" }}>{title}</h3>}
          {subtitle && <p style={{ margin: 0, fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>{subtitle}</p>}
        </header>
        <div style={{ padding: "16px 20px", fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>{children}</div>
        {footer && (
          <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 20px 18px" }}>{footer}</footer>
        )}
      </div>
    </div>
  );
}
