import React from "react";

/**
 * Sankey flow diagram — built for path analysis ("landing → property → action → exit").
 * nodes: [{ id, label, column, color? }]  links: [{ from, to, value }]
 * Layout is computed from the data: node value = max(inflow, outflow).
 */
export function SankeyDiagram({
  nodes = [],
  links = [],
  height = 260,
  nodeWidth = 10,
  nodeGap = 14,
  format = (v) => v.toLocaleString(),
  style
}) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(680);
  const [hover, setHover] = React.useState(null);
  React.useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => setW(es[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const layout = React.useMemo(() => {
    const byId = {};
    nodes.forEach((n) => (byId[n.id] = { ...n, in: 0, out: 0 }));
    links.forEach((l) => {
      if (byId[l.from]) byId[l.from].out += l.value;
      if (byId[l.to]) byId[l.to].in += l.value;
    });
    const list = Object.values(byId).map((n) => ({ ...n, value: Math.max(n.in, n.out) }));
    const cols = [...new Set(list.map((n) => n.column))].sort((a, b) => a - b);
    const colW = cols.length > 1 ? (w - nodeWidth) / (cols.length - 1) : 0;
    const maxColSum = Math.max(...cols.map((c) => list.filter((n) => n.column === c).reduce((a, n) => a + n.value, 0)), 1);
    const maxCount = Math.max(...cols.map((c) => list.filter((n) => n.column === c).length), 1);
    const usable = height - nodeGap * (maxCount - 1);
    const scale = usable / maxColSum;
    const placed = {};
    cols.forEach((c) => {
      const inCol = list.filter((n) => n.column === c);
      const colHeight = inCol.reduce((a, n) => a + n.value * scale, 0) + nodeGap * (inCol.length - 1);
      let y = (height - colHeight) / 2;
      inCol.forEach((n) => {
        const h = Math.max(n.value * scale, 2);
        placed[n.id] = { ...n, x: cols.indexOf(c) * colW, y, h };
        y += h + nodeGap;
      });
    });
    const cursor = {};
    const ribbons = links.map((l, i) => {
      const a = placed[l.from], b = placed[l.to];
      if (!a || !b) return null;
      const ka = "o" + l.from, kb = "i" + l.to;
      cursor[ka] = cursor[ka] || 0; cursor[kb] = cursor[kb] || 0;
      const th = Math.max(l.value * scale, 1.2);
      const y0 = a.y + cursor[ka], y1 = b.y + cursor[kb];
      cursor[ka] += th; cursor[kb] += th;
      const x0 = a.x + nodeWidth, x1 = b.x;
      const mx = (x0 + x1) / 2;
      const d = `M${x0} ${y0} C${mx} ${y0} ${mx} ${y1} ${x1} ${y1} L${x1} ${y1 + th} C${mx} ${y1 + th} ${mx} ${y0 + th} ${x0} ${y0 + th} Z`;
      return { id: i, d, link: l, color: a.color };
    }).filter(Boolean);
    return { placed: Object.values(placed), ribbons };
  }, [nodes, links, w, height, nodeWidth, nodeGap]);

  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minWidth: 0, ...style }}>
      <svg width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        {layout.ribbons.map((r) => {
          const on = hover === r.id;
          return (
            <path
              key={r.id}
              d={r.d}
              fill={r.color || "var(--glacier-400)"}
              fillOpacity={hover === null ? 0.13 : on ? 0.42 : 0.06}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: "fill-opacity var(--dur-2) var(--ease-out)" }}
            />
          );
        })}
        {layout.placed.map((n) => (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={nodeWidth} height={n.h} rx={3} fill={n.color || "var(--ink-200)"} />
          </g>
        ))}
      </svg>
      {layout.placed.map((n) => {
        const lastCol = n.x > w - nodeWidth - 1;
        return (
          <div
            key={"l" + n.id}
            style={{
              position: "absolute",
              left: lastCol ? undefined : n.x + nodeWidth + 7,
              right: lastCol ? nodeWidth + 7 : undefined,
              top: n.y + n.h / 2,
              transform: "translateY(-50%)",
              display: "grid", gap: 1, pointerEvents: "none",
              textAlign: lastCol ? "right" : "left",
              maxWidth: 150
            }}
          >
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 1px 4px rgba(5,6,7,.92)" }}>{n.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "var(--tnum)", fontSize: "var(--size-micro)", color: "var(--text-muted)", textShadow: "0 1px 4px rgba(5,6,7,.92)" }}>{format(n.value)}</span>
          </div>
        );
      })}
      {hover !== null && layout.ribbons[hover] && (
        <div
          style={{
            position: "absolute", top: 0, right: 0,
            padding: "7px 10px", borderRadius: "var(--radius-2)",
            background: "var(--glass-bg)", border: "var(--glass-border)",
            backdropFilter: "var(--glass-blur)", WebkitBackdropFilter: "var(--glass-blur)",
            boxShadow: "var(--shadow-3)", pointerEvents: "none",
            fontSize: "var(--size-micro)", color: "var(--text-primary)", whiteSpace: "nowrap"
          }}
        >
          {layout.ribbons[hover].link.from} → {layout.ribbons[hover].link.to}
          <span style={{ fontFamily: "var(--font-mono)", marginLeft: 8, color: "var(--glacier-300)" }}>
            {format(layout.ribbons[hover].link.value)}
          </span>
        </div>
      )}
    </div>
  );
}
