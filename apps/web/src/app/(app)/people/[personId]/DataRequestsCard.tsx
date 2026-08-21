"use client";

import { Badge, Button, Card, Icon } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { raiseDataRequest } from "@/server/actions/data-requests";
import { relative } from "@/lib/format";

export interface DataRequestView {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

const STATUS_TONE: Record<string, "up" | "down" | "neutral" | "warn"> = {
  pending: "neutral",
  processing: "warn",
  completed: "up",
  failed: "down",
};

/**
 * Raise a GDPR export or erasure request, and show the history of past ones.
 * Both are queued — a worker (`processDataRequests`) drains them — so a
 * click here doesn't remove the profile immediately; the status list is
 * what tells the operator it actually happened.
 */
export function DataRequestsCard({
  personId,
  canRequest,
  requests,
}: {
  personId: string;
  canRequest: boolean;
  requests: DataRequestView[];
}) {
  const { run, pending } = useAction();

  async function requestExport() {
    await run(() => raiseDataRequest(personId, "export"));
  }

  async function requestErasure() {
    await run(() => raiseDataRequest(personId, "delete"));
  }

  return (
    <Card title="Data requests" subtitle="GDPR export and erasure">
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        {canRequest ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              size="sm"
              iconLeft={<Icon name="download" size={13} />}
              disabled={pending}
              onClick={requestExport}
            >
              Request export
            </Button>
            <Button
              size="sm"
              variant="danger"
              iconLeft={<Icon name="trash-2" size={13} />}
              disabled={pending}
              onClick={requestErasure}
            >
              Request erasure
            </Button>
          </div>
        ) : (
          <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", margin: 0 }}>
            An owner or admin can raise a request for this person.
          </p>
        )}

        {requests.length === 0 ? (
          <Empty
            dense
            icon="shield"
            title="No requests yet"
            body="Nothing has been exported or erased for this person."
          />
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {requests.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--grid-line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                  <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>
                    {r.kind === "delete" ? "Erasure" : "Export"}
                  </span>
                </div>
                <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  {relative(r.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
