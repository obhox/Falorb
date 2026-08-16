"use client";

import React from "react";

/** Left rail for the Falorb dashboard: sections of rows, each optionally with a trailing figure. */
export function SidebarNav({ sections = [], value, onChange, footer, style }) {
  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)", ...style }}>
      {sections.map((sec, si) => (
        <div key={sec.label || si} style={{ display: "grid", gap: 2 }}>
          {sec.label && (
            <div
              style={{
                padding: "0 10px 6px", fontSize: "var(--size-micro)", textTransform: "uppercase",
                letterSpacing: "var(--ls-label)", color: "var(--text-muted)", fontWeight: "var(--wt-medium)"
              }}
            >
              {sec.label}
            </div>
          )}
          {sec.items.map((it) => {
            const on = it.value === value;
            return (
              <button
                key={it.value}
                onClick={() => onChange && onChange(it.value)}
                style={{
                  display: "flex", alignItems: "center", gap: 9, width: "100%",
                  height: 32, padding: "0 10px", borderRadius: "var(--radius-3)",
                  border: "1px solid " + (on ? "rgba(125,211,252,.16)" : "transparent"),
                  background: on ? "var(--surface-selected)" : "transparent",
                  color: on ? "var(--glacier-100)" : "var(--text-secondary)",
                  fontFamily: "var(--font-sans)", fontSize: "var(--size-body-sm)",
                  fontWeight: on ? "var(--wt-medium)" : "var(--wt-regular)",
                  cursor: "pointer", textAlign: "left",
                  transition: "background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out)"
                }}
                onMouseEnter={(e) => { if (!on) { e.currentTarget.style.background = "var(--surface-hover)"; e.currentTarget.style.color = "var(--text-primary)"; } }}
                onMouseLeave={(e) => { if (!on) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; } }}
              >
                {it.icon}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                {it.meta !== undefined && (
                  <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                    {it.meta}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
      {footer && <div style={{ marginTop: "auto" }}>{footer}</div>}
    </nav>
  );
}
