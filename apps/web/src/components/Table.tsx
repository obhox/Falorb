/** A compact table. Numeric columns are mono and right-aligned. */
export function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  const grid = `minmax(0, 1.7fr) repeat(${head.length - 1}, 92px)`;

  return (
    <div style={{ display: "grid", gap: 1 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: grid,
          gap: 12,
          height: 30,
          alignItems: "center",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: "var(--size-micro)",
          textTransform: "uppercase",
          letterSpacing: "var(--ls-label)",
          color: "var(--text-muted)",
          fontWeight: "var(--wt-medium)",
        }}
      >
        {head.map((cell, index) => (
          <span key={cell} style={{ textAlign: index === 0 ? "left" : "right" }}>
            {cell}
          </span>
        ))}
      </div>

      {rows.map((row) => (
        <div
          key={row[0]}
          style={{
            display: "grid",
            gridTemplateColumns: grid,
            gap: 12,
            minHeight: "var(--row-height-dense)",
            alignItems: "center",
            borderBottom: "1px solid var(--grid-line)",
          }}
        >
          {row.map((cell, index) => (
            <span
              key={index}
              title={index === 0 ? cell : undefined}
              style={{
                fontFamily: "var(--font-mono)",
                fontFeatureSettings: "var(--tnum)",
                fontSize: "var(--size-label)",
                color: index === 0 ? "var(--text-body)" : "var(--text-primary)",
                textAlign: index === 0 ? "left" : "right",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
