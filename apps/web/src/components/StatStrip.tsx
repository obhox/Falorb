import { StatTile } from "@falorb/ui";

/**
 * The row of headline figures at the top of a screen.
 *
 * Values arrive already formatted — the design system is explicit that
 * components render figures rather than compute them. `delta` is a number or
 * null; null means there was no previous period worth comparing against, and
 * the tile then shows no pill at all rather than a misleading one.
 */

export interface Stat {
  label: string;
  value: string;
  unit?: string;
  delta?: number | null;
  /** Down is good — bounce rate, exit rate, error count. */
  invertDelta?: boolean;
  series?: number[];
  footnote?: string;
}

export function StatStrip({ stats, columns }: { stats: Stat[]; columns?: number }) {
  return (
    <div
      className="falorb-grid-stats"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns ?? stats.length}, minmax(0, 1fr))`,
        gap: "var(--space-6)",
      }}
    >
      {stats.map((stat) => (
        <StatTile
          key={stat.label}
          label={stat.label}
          value={stat.value}
          unit={stat.unit}
          // `undefined` rather than `null`: the component treats any defined
          // value as "render a pill", so an unknown delta must be absent.
          // Rounded here because DeltaPill prints a number verbatim, and the
          // rule is one decimal on every percentage.
          delta={stat.delta == null ? undefined : Math.round(stat.delta * 10) / 10}
          invertDelta={stat.invertDelta}
          series={stat.series}
          footnote={stat.footnote}
        />
      ))}
    </div>
  );
}
