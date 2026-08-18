"use client";

import { Button, Card } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { regenerateContentSignal } from "@/server/actions/signals";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";
import type { DateRange } from "@falorb/queries";

export interface ContentSignalView {
  body: string;
  generatedAt: string;
}

/**
 * The AI recommendation panel — a synthesis of every other panel on this
 * page, not a new data source. Generation is triggered by the reader, not on
 * every page load: the underlying data only meaningfully changes over hours,
 * and an LLM call on every render would be slow and needlessly expensive.
 */
export function ContentSignalPanel({
  slug,
  range,
  signal,
}: {
  slug: string;
  range: DateRange;
  signal: ContentSignalView | null;
}) {
  const { run, pending } = useAction();

  async function regenerate() {
    await run(() => regenerateContentSignal(slug, range), { success: "Recommendation updated" });
  }

  return (
    <Card
      title="What to focus on"
      subtitle="Generated from the panels above — not a new data source"
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
          body="Generate one from the current range's page performance and interest data."
        />
      )}
    </Card>
  );
}
