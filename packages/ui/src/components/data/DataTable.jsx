"use client";

import React from "react";

/**
 * Dense data table. Columns: { key, header, width, align, mono, render }.
 * Header is sticky; rows are 38px (30px when dense) with a hairline separator.
 */
export function DataTable({ columns = [], rows = [], dense = false, onRowClick, selectedId, emptyState, style }) {
  const h = dense ? "var(--row-height-dense)" : "var(--row-height)";
  const grid = columns.map((c) => c.width || "1fr").join(" ");
  return (
    <div className="falorb-scroll-x">
    <div style={{ display: "grid", ...style }}>
      <div
        style={{
          display: "grid", gridTemplateColumns: grid, alignItems: "center",
          gap: 12, height: 30, padding: "0 12px",
          borderBottom: "1px solid var(--border-subtle)",
          position: "sticky", top: 0, zIndex: 2,
          background: "var(--surface-panel)"
        }}
      >
        {columns.map((c) => (
          <span
            key={c.key}
            style={{
              fontSize: "var(--size-micro)", textTransform: "uppercase",
              letterSpacing: "var(--ls-label)", color: "var(--text-muted)",
              fontWeight: "var(--wt-medium)",
              textAlign: c.align || "left",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}
          >
            {c.header}
          </span>
        ))}
      </div>
      {rows.length === 0 && emptyState}
      {rows.map((r, i) => {
        const on = selectedId !== undefined && r.id === selectedId;
        return (
          <div
            key={r.id ?? i}
            onClick={() => onRowClick && onRowClick(r)}
            style={{
              display: "grid", gridTemplateColumns: grid, alignItems: "center",
              gap: 12, minHeight: h, padding: "0 12px",
              borderBottom: "1px solid var(--grid-line)",
              background: on ? "var(--surface-selected)" : "transparent",
              cursor: onRowClick ? "pointer" : "default",
              transition: "background var(--dur-1) var(--ease-out)"
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--surface-hover)"; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
          >
            {columns.map((c) => (
              <span
                key={c.key}
                style={{
                  display: "flex", alignItems: "center",
                  justifyContent: c.align === "right" ? "flex-end" : c.align === "center" ? "center" : "flex-start",
                  gap: 7, minWidth: 0,
                  fontFamily: c.mono ? "var(--font-mono)" : "var(--font-sans)",
                  fontFeatureSettings: c.mono ? "var(--tnum)" : undefined,
                  fontSize: dense ? "var(--size-label)" : "var(--size-body-sm)",
                  color: c.mono ? "var(--text-primary)" : "var(--text-body)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }}
              >
                {c.render ? c.render(r) : r[c.key]}
              </span>
            ))}
          </div>
        );
      })}
    </div>
    </div>
  );
}
