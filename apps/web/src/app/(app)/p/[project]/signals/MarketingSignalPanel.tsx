"use client";

import { Button, Card } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { regenerateMarketingSignal } from "@/server/actions/signals";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";
import type { DateRange } from "@falorb/queries";

export interface MarketingSignalView {
  body: string;
  generatedAt: string;
}

/**
 * Which channels are working, generated from the channel breakdown and
 * referral leaderboard already shown on this page — a synthesis, not a new
 * data source.
 */
export function MarketingSignalPanel({
  slug,
  range,
  signal,
}: {
  slug: string;
  range: DateRange;
  signal: MarketingSignalView | null;
}) {
  const { run, pending } = useAction();

  async function regenerate() {
    await run(() => regenerateMarketingSignal(slug, range), { success: "Recommendation updated" });
  }

  return (
    <Card
      title="What's working"
      subtitle="Generated from the channel and referral figures above"
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
          body="Generate one from the current range's channel performance and referral activity."
        />
      )}
    </Card>
  );
}
