"use client";

import Link from "next/link";
import { Badge, Button, Card } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { resolveEscalationAction } from "@/server/actions/support";

const STATUS_TONE: Record<string, "warn" | "neutral" | "up" | "down"> = {
  open: "warn",
  in_progress: "warn",
  active: "up",
  handoff: "warn",
  resolved: "up",
  closed: "neutral",
};

export function EscalationSummaryCard({
  escalationId,
  status,
  personId,
}: {
  escalationId: string;
  status: string | null;
  personId: string | null;
}) {
  const { run, pending } = useAction();

  return (
    <Card title="Status">
      <div style={{ display: "grid", gap: 10 }}>
        <Badge tone={STATUS_TONE[status ?? ""] ?? "neutral"}>{status ?? "—"}</Badge>
        {personId && (
          <Link href={`/people/${personId}`} data-plain style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)" }}>
            View person →
          </Link>
        )}
        {status !== "resolved" && (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => void run(() => resolveEscalationAction(escalationId), { success: "Resolved." })}
            style={{ justifySelf: "start" }}
          >
            Resolve
          </Button>
        )}
      </div>
    </Card>
  );
}
