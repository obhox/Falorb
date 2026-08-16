import Link from "next/link";
import { Card } from "@falorb/ui";
import type { SavedFunnel } from "@/server/funnels";
import { serializeSteps } from "@/lib/funnel-spec";

/**
 * The project's named funnels, as links into the builder.
 *
 * Each one is an ordinary URL carrying the whole definition, so opening a
 * saved funnel and hand-editing one built from scratch land in exactly the
 * same state — there is no second, parallel "saved funnel" mode to keep in
 * step with the builder.
 */
export function SavedFunnels({
  slug,
  funnels,
  activeSteps,
}: {
  slug: string;
  funnels: SavedFunnel[];
  /** Serialized steps currently in the URL, used to mark the open one. */
  activeSteps: string;
}) {
  if (funnels.length === 0) return null;

  return (
    <Card
      title="Saved funnels"
      subtitle={`${funnels.length} defined for this property`}
      padding="var(--pad-panel)"
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {funnels.map((funnel) => {
          const steps = serializeSteps(funnel.steps);
          const isActive = steps === activeSteps;

          return (
            <Link
              key={funnel.id}
              href={`/p/${slug}/funnels?steps=${encodeURIComponent(steps)}&window=${funnel.windowHours}`}
              data-plain
              title={funnel.description ?? undefined}
              style={{
                display: "grid",
                gap: 2,
                padding: "8px 12px",
                borderRadius: "var(--radius-2)",
                textDecoration: "none",
                background: isActive ? "var(--surface-selected)" : "var(--surface-raised)",
                border: `1px solid ${isActive ? "var(--border-strong)" : "var(--border-subtle)"}`,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: "var(--size-body-sm)",
                  color: isActive ? "var(--text-primary)" : "var(--text-body)",
                }}
              >
                {funnel.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--size-micro)",
                  color: "var(--text-muted)",
                }}
              >
                {funnel.steps.length} steps · {funnel.windowHours}h
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
