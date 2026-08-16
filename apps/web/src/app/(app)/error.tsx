"use client";

import { useEffect } from "react";
import { Button, Card, Icon } from "@falorb/ui";

/**
 * Route-level error boundary.
 *
 * The message is shown rather than swallowed. Nearly every failure on these
 * screens is a query or connection problem — "ClickHouse connection refused",
 * "unknown filter field" — and the text is the fastest route to the cause. It
 * is a self-hosted instance; the operator reading this owns the database.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div style={{ padding: "var(--pad-panel)", display: "grid", placeItems: "center", flex: 1 }}>
      <Card tone="panel" style={{ maxWidth: 560 }}>
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--signal-down)", display: "inline-flex" }}>
              <Icon name="triangle-alert" size={18} />
            </span>
            <h2 style={{ fontSize: "var(--size-subtitle)" }}>This panel could not load</h2>
          </div>

          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--size-label)",
              color: "var(--text-body)",
              background: "var(--surface-inset)",
              border: "1px solid var(--control-border)",
              borderRadius: "var(--radius-3)",
              padding: "var(--space-5) var(--space-6)",
              lineHeight: "var(--lh-normal)",
              wordBreak: "break-word",
            }}
          >
            {error.message || "No message was attached to the error."}
          </p>

          <p style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
            Most failures here are the event store being unreachable. Check that ClickHouse and
            Postgres are running, then retry.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" onClick={reset}>
              Retry
            </Button>
            {error.digest && (
              <span
                style={{
                  alignSelf: "center",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--size-micro)",
                  color: "var(--text-muted)",
                }}
              >
                {error.digest}
              </span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
