"use client";

import { Button, Card } from "@falorb/ui";
import { draftContentPage } from "@/server/actions/content-draft";
import { useAction } from "@/lib/use-action";
import { num, signedPct } from "@/lib/format";

export interface RisingThinRow {
  topic: string;
  visitors: number;
  isNew: boolean;
  changePct: number | null;
  distinctPaths: number;
}

const GRID = "minmax(0, 1.7fr) 92px 92px 72px 140px";

/**
 * "Rising interest, thin coverage" as an actionable table rather than a
 * read-only one — each row can draft a page for its topic in one click via
 * `draftContentPage`, instead of leaving that as something the owner has to
 * come back and do by hand.
 */
export function RisingThinPanel({ slug, rows }: { slug: string; rows: RisingThinRow[] }) {
  return (
    <Card
      title="Rising interest, thin coverage"
      subtitle="Growing topics backed by only a page or two — the concrete case for what to write next"
    >
      <div className="falorb-scroll-x">
        <div style={{ display: "grid", gap: 1, minWidth: 560 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID,
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
            <span>Topic</span>
            <span style={{ textAlign: "right" }}>Visitors</span>
            <span style={{ textAlign: "right" }}>Change</span>
            <span style={{ textAlign: "right" }}>Pages</span>
            <span />
          </div>
          {rows.map((row) => (
            <RisingThinRowItem key={row.topic} slug={slug} row={row} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function RisingThinRowItem({ slug, row }: { slug: string; row: RisingThinRow }) {
  const { run, pending } = useAction();

  async function draft() {
    await run(() => draftContentPage(slug, row.topic));
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID,
        gap: 12,
        minHeight: "var(--row-height-dense)",
        alignItems: "center",
        borderBottom: "1px solid var(--grid-line)",
      }}
    >
      <span
        title={row.topic}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--size-label)",
          color: "var(--text-body)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.topic}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontFeatureSettings: "var(--tnum)",
          fontSize: "var(--size-label)",
          color: "var(--text-primary)",
          textAlign: "right",
        }}
      >
        {num(row.visitors)}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontFeatureSettings: "var(--tnum)",
          fontSize: "var(--size-label)",
          color: "var(--text-primary)",
          textAlign: "right",
        }}
      >
        {row.isNew ? "New" : signedPct(row.changePct)}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontFeatureSettings: "var(--tnum)",
          fontSize: "var(--size-label)",
          color: "var(--text-primary)",
          textAlign: "right",
        }}
      >
        {num(row.distinctPaths)}
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" onClick={draft} disabled={pending}>
          {pending ? "Drafting…" : "Draft this page"}
        </Button>
      </span>
    </div>
  );
}
