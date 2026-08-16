import React from "react";

/**
 * Weekday × hour activity grid. rows: string[], cols: string[], values: number[][].
 * Intensity is glacier alpha, so it stays inside the monotone palette.
 */
export function HeatmapGrid({ rows = [], cols = [], values = [], cell = 14, gap = 3, format = (v) => v.toLocaleString(), style }) {
  const [hover, setHover] = React.useState(null);
  const max = Math.max(...values.flat(), 1);
  return (
    <div style={{ display: "grid", gap: 8, flex: 1, alignContent: "start", ...style }}>
      <div style={{ display: "grid", gap, gridTemplateColumns: `34px repeat(${cols.length}, minmax(0,1fr))` }}>
        {rows.map((r, ri) => (
          <React.Fragment key={r}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)", color: "var(--text-muted)", display: "flex", alignItems: "center" }}>{r}</span>
            {cols.map((c, ci) => {
              const v = values[ri]?.[ci] ?? 0;
              const a = v / max;
              const on = hover && hover[0] === ri && hover[1] === ci;
              return (
                <span
                  key={c}
                  onMouseEnter={() => setHover([ri, ci])}
                  onMouseLeave={() => setHover(null)}
                  title={`${r} ${c} · ${format(v)}`}
                  style={{
                    height: cell, borderRadius: 3,
                    background: a === 0 ? "var(--w-2)" : `rgba(125,211,252,${(0.10 + a * 0.78).toFixed(3)})`,
                    outline: on ? "1px solid var(--w-40)" : "none",
                    transition: "outline-color var(--dur-1) var(--ease-out)"
                  }}
                />
              );
            })}
          </React.Fragment>
        ))}
        <span />
        {cols.map((c, i) => (
          <span key={c} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)", color: "var(--text-muted)", textAlign: "center", overflow: "hidden" }}>
            {i % 2 === 0 ? c : ""}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
        <span>0</span>
        {[0.1, 0.3, 0.5, 0.7, 0.88].map((a) => (
          <span key={a} style={{ width: 16, height: 8, borderRadius: 2, background: `rgba(125,211,252,${a})` }} />
        ))}
        <span>{format(max)}</span>
        {hover && (
          <span style={{ marginLeft: "auto", color: "var(--text-primary)" }}>
            {rows[hover[0]]} {cols[hover[1]]} · {format(values[hover[0]][hover[1]])}
          </span>
        )}
      </div>
    </div>
  );
}
