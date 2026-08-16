"use client";

import { useState } from "react";
import Link from "next/link";
import { DeltaPill, Icon, Sparkline } from "@falorb/ui";

/**
 * One property in the portfolio list.
 *
 * A link rather than a click handler, so a reader can open three properties in
 * three tabs — which is exactly what someone with ten sites does. Hover swaps
 * the sparkline from graphite to glacier: the accent marks the series in
 * focus, and here focus means "the row under the cursor".
 */
export function PropertyRow({
  href,
  domain,
  name,
  visitors,
  sessions,
  series,
  delta,
}: {
  href: string;
  domain: string;
  name: string;
  visitors: string;
  sessions: string;
  series: number[];
  delta: number | null;
}) {
  const [hover, setHover] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid",
        gridTemplateColumns: "1.5fr 120px 1fr 96px 88px 24px",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        textDecoration: "none",
        background: hover ? "var(--surface-hover)" : "var(--surface-card)",
        border: `1px solid ${hover ? "var(--border-default)" : "var(--border-subtle)"}`,
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--edge-top)",
        transition:
          "background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out)",
      }}
    >
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            fontWeight: "var(--wt-medium)",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <Icon name="globe" size={13} />
          {domain}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
      </div>

      <div style={{ display: "grid", gap: 2 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontFeatureSettings: "var(--tnum)",
            fontSize: 17,
            letterSpacing: "-.03em",
            color: "var(--metric-fg)",
          }}
        >
          {visitors}
        </span>
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "var(--ls-label)",
            color: "var(--text-muted)",
          }}
        >
          visitors
        </span>
      </div>

      <Sparkline
        data={series}
        height={34}
        color={hover ? "var(--glacier-400)" : "var(--series-2)"}
      />

      <span
        style={{
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontFeatureSettings: "var(--tnum)",
          fontSize: 13,
          color: "var(--text-body)",
        }}
      >
        {sessions}
      </span>

      <span style={{ display: "flex", justifyContent: "flex-end" }}>
        {delta == null ? (
          // No prior period to compare against — a pill here would be an
          // assertion the data does not support.
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>—</span>
        ) : (
          <DeltaPill value={Math.round(delta * 10) / 10} size="sm" />
        )}
      </span>

      <span
        style={{
          color: hover ? "var(--text-primary)" : "var(--text-muted)",
          display: "inline-flex",
          justifyContent: "flex-end",
        }}
      >
        <Icon name="chevron-right" size={15} />
      </span>
    </Link>
  );
}
