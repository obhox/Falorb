"use client";

import { Button, Card } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { regenerateProductSignal } from "@/server/actions/signals";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";
import type { DateRange } from "@falorb/queries";

export interface ProductSignalView {
  body: string;
  generatedAt: string;
}

/**
 * What people want that doesn't exist yet — the same interest data as the
 * Content panel above, asked a different question: a product/feature gap
 * rather than a content-priority one. Deliberately doesn't factor in
 * funnel/goal drop-off (no cross-funnel aggregation exists in this codebase
 * yet) — the subtitle says so, rather than implying more analysis happened.
 */
export function ProductSignalPanel({
  slug,
  range,
  signal,
}: {
  slug: string;
  range: DateRange;
  signal: ProductSignalView | null;
}) {
  const { run, pending } = useAction();

  async function regenerate() {
    await run(() => regenerateProductSignal(slug, range), { success: "Recommendation updated" });
  }

  return (
    <Card
      title="What people want that isn't here yet"
      subtitle="From the interest graph above, not funnel or drop-off data"
      action={
        <Button size="sm" variant="secondary" onClick={regenerate} disabled={pending}>
          {pending ? "Generating…" : signal ? "Regenerate" : "Generate"}
        </Button>
      }
    >
      {signal ? (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <p
            style={{
              fontSize: "var(--size-body)",
              lineHeight: 1.6,
              color: "var(--text-body)",
              whiteSpace: "pre-wrap",
            }}
          >
            {signal.body}
          </p>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            Generated {relative(signal.generatedAt)}
          </span>
        </div>
      ) : (
        <Empty
          dense
          icon="sparkles"
          title="No recommendation yet"
          body="Generate one from the current range's interest data."
        />
      )}
    </Card>
  );
}
