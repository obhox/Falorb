"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Tabs } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { decideApprovalAction } from "@/server/actions/agents";
import { relative } from "@/lib/format";

export interface ApprovalItem {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  runId: string;
  toolName: string;
  title: string;
  rationale: string | null;
  risk: string;
  status: string;
  arguments: unknown;
  expiresAt: string;
  createdAt: string;
  error: string | null;
  canDecide: boolean;
}

const RISK_TONE: Record<string, "neutral" | "warn" | "down"> = {
  low: "neutral",
  medium: "warn",
  high: "down",
};

const STATUS_TONE: Record<string, "up" | "down" | "neutral"> = {
  executed: "up",
  approved: "up",
  rejected: "neutral",
  expired: "neutral",
  failed: "down",
};

export function ApprovalQueue({
  pending,
  recent,
  now,
}: {
  pending: ApprovalItem[];
  recent: ApprovalItem[];
  now: number;
}) {
  const [tab, setTab] = useState("pending");
  const { run, pending: busy } = useAction();

  return (
    <div style={{ display: "grid", gap: "var(--space-5)", maxWidth: 860 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "pending", label: "Waiting", count: pending.length },
          { value: "recent", label: "Decided", count: recent.length },
        ]}
      />

      {tab === "pending" &&
        (pending.length === 0 ? (
          <Empty
            icon="shield-check"
            title="Nothing waiting"
            body="When an agent wants to do something that reaches a customer or another system, it appears here with its reasoning."
          />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {pending.map((item) => (
              <Card key={item.id} tone="card" padding={16}>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>
                      {item.agentAvatar}
                    </span>
                    <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5 }}>
                        {item.title}
                      </span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <Link
                          href={`/agents/${item.agentId}`}
                          data-plain
                          style={{ fontSize: 11.5, color: "var(--text-muted)" }}
                        >
                          {item.agentName}
                        </Link>
                        <Badge tone={RISK_TONE[item.risk] ?? "neutral"}>{item.risk} risk</Badge>
                        <Badge tone="neutral" mono>
                          {item.toolName}
                        </Badge>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          asked {relative(item.createdAt, now)} · expires{" "}
                          {relative(item.expiresAt, now)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {item.rationale && (
                    <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                      {item.rationale}
                    </p>
                  )}

                  <pre
                    style={{
                      margin: 0,
                      padding: 10,
                      borderRadius: 8,
                      background: "var(--surface-inset)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                      overflowX: "auto",
                      maxHeight: 200,
                    }}
                  >
                    {JSON.stringify(item.arguments, null, 2)}
                  </pre>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      borderTop: "1px solid var(--border-subtle)",
                      paddingTop: 12,
                    }}
                  >
                    <Link
                      href={`/agents/${item.agentId}/runs/${item.runId}`}
                      data-plain
                      style={{ fontSize: 12, color: "var(--text-muted)" }}
                    >
                      See the whole shift
                    </Link>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      {item.canDecide ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void run(() => decideApprovalAction(item.id, "reject"))}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="accent"
                            disabled={busy}
                            onClick={() => void run(() => decideApprovalAction(item.id, "approve"))}
                          >
                            Approve
                          </Button>
                        </>
                      ) : (
                        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                          You cannot perform this action yourself, so you cannot approve it. Ask an
                          admin or owner.
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ))}

      {tab === "recent" &&
        (recent.length === 0 ? (
          <Empty
            dense
            icon="history"
            title="Nothing decided yet"
            body="Approved and rejected requests are kept here as a record of what was agreed to."
          />
        ) : (
          <Card title="Decided" subtitle="What was approved, rejected, or left to expire">
            <div style={{ display: "grid", gap: 10 }}>
              {recent.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: 10,
                  }}
                >
                  <span aria-hidden>{item.agentAvatar}</span>
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1, minWidth: 0 }}>
                    {item.title}
                    {item.error && (
                      <span style={{ color: "var(--text-danger, #d66)" }}> — {item.error}</span>
                    )}
                  </span>
                  <Badge tone={STATUS_TONE[item.status] ?? "neutral"}>{item.status}</Badge>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {relative(item.createdAt, now)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
    </div>
  );
}
