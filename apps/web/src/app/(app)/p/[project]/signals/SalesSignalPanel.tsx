"use client";

import { useState } from "react";
import { Button, Card, SegmentedControl } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { regenerateSalesSignal } from "@/server/actions/signals";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";
import type { DateRange } from "@falorb/queries";

export interface SalesSignalView {
  body: string;
  generatedAt: string;
}

const SCOPE_LABELS = { project: "This property", portfolio: "Across your portfolio" } as const;
type Scope = keyof typeof SCOPE_LABELS;

/**
 * Who to personally reach out to, in two independently-cached scopes.
 *
 * "Across your portfolio" isn't about the one property this page happens to
 * be on — it's the same result wherever you open it from, since the whole
 * point is people active on more than one of your properties. The toggle
 * just switches which of the two already-fetched signals is shown; nothing
 * refetches on click.
 */
export function SalesSignalPanel({
  slug,
  range,
  signals,
}: {
  slug: string;
  range: DateRange;
  signals: Record<Scope, SalesSignalView | null>;
}) {
  const [scope, setScope] = useState<Scope>("project");
  const { run, pending } = useAction();

  const signal = signals[scope];

  async function regenerate() {
    await run(() => regenerateSalesSignal(slug, range, scope), { success: "Recommendation updated" });
  }

  return (
    <Card
      title="Who to contact"
      subtitle="Generated from lead score, activity and company data — not a new data source"
      action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SegmentedControl
            size="sm"
            options={Object.values(SCOPE_LABELS)}
            value={SCOPE_LABELS[scope]}
            onChange={(label: string) =>
              setScope((Object.keys(SCOPE_LABELS) as Scope[]).find((k) => SCOPE_LABELS[k] === label) ?? "project")
            }
          />
          <Button size="sm" variant="secondary" onClick={regenerate} disabled={pending}>
            {pending ? "Generating…" : signal ? "Regenerate" : "Generate"}
          </Button>
        </div>
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
          body={
            scope === "project"
              ? "Generate one from this property's highest lead-score visitors."
              : "Generate one from people active across more than one of your properties."
          }
        />
      )}
    </Card>
  );
}
