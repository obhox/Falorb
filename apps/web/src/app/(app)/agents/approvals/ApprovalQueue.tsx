"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Checkbox, Input, Select, Tabs } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import {
  decideApprovalAction,
  decideApprovalsAction,
  revokeApprovalGrantAction,
} from "@/server/actions/agents";
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
  decisionNote: string | null;
  canDecide: boolean;
}

export interface GrantItem {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  toolName: string;
  grantedByName: string | null;
  expiresAt: string;
}

/** Offered next to "Approve": how long the agent may do this unasked. */
const GRANT_OPTIONS: { label: string; days: number | undefined }[] = [
  { label: "just this once", days: undefined },
  { label: "and for a day", days: 1 },
  { label: "and for a week", days: 7 },
  { label: "and for 30 days", days: 30 },
];

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
  grants,
  canReview,
  now,
}: {
  pending: ApprovalItem[];
  recent: ApprovalItem[];
  grants: GrantItem[];
  canReview: boolean;
  now: number;
}) {
  const [tab, setTab] = useState("pending");
  const { run, pending: busy } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [grantLabel, setGrantLabel] = useState(GRANT_OPTIONS[0]!.label);
  const grantDays = GRANT_OPTIONS.find((o) => o.label === grantLabel)?.days;

  const decidable = pending.filter((p) => p.canDecide);
  const chosen = decidable.filter((p) => selected.has(p.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function decideMany(decision: "approve" | "reject") {
    const ids = chosen.map((c) => c.id);
    const result = await run(() =>
      decideApprovalsAction(ids, decision, note || undefined, decision === "approve" ? grantDays : undefined),
    );
    if (result?.ok) {
      setSelected(new Set());
      setNote("");
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-5)", maxWidth: 860 }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "pending", label: "Waiting", count: pending.length },
          { value: "recent", label: "Decided", count: recent.length },
          { value: "grants", label: "Standing approvals", count: grants.length },
        ]}
      />

      {tab === "pending" && decidable.length > 0 && (
        <Card tone="inset" padding={14}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Checkbox
                checked={chosen.length === decidable.length && decidable.length > 0}
                onChange={(on) => setSelected(on ? new Set(decidable.map((d) => d.id)) : new Set())}
                label={
                  chosen.length
                    ? `${chosen.length} of ${decidable.length} selected`
                    : `Select all ${decidable.length} you can decide`
                }
              />
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Select
                  size="sm"
                  value={grantLabel}
                  options={GRANT_OPTIONS.map((o) => o.label)}
                  onChange={setGrantLabel}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !chosen.length}
                  onClick={() => void decideMany("reject")}
                >
                  Reject {chosen.length || ""}
                </Button>
                <Button
                  size="sm"
                  variant="accent"
                  disabled={busy || !chosen.length}
                  onClick={() => void decideMany("approve")}
                >
                  Approve {chosen.length || ""}
                </Button>
              </div>
            </div>
            <Input
              size="sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note — the agent reads this at the start of its next shift"
            />
            {grantDays && (
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Approving with a standing grant lets each selected agent perform that same action
                without asking for {grantDays === 1 ? "a day" : `${grantDays} days`}. Withdraw it any time
                under "Standing approvals".
              </span>
            )}
          </div>
        </Card>
      )}

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
                    {item.canDecide && (
                      <Checkbox
                        checked={selected.has(item.id)}
                        onChange={(on) => toggle(item.id, on)}
                        style={{ marginTop: 2 }}
                      />
                    )}
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
                            onClick={() =>
                              void run(() => decideApprovalAction(item.id, "reject", note || undefined))
                            }
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="accent"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                decideApprovalAction(item.id, "approve", note || undefined, grantDays),
                              )
                            }
                          >
                            {grantDays ? `Approve ${grantLabel}` : "Approve"}
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
                    {item.decisionNote && (
                      <span style={{ color: "var(--text-muted)" }}> — "{item.decisionNote}"</span>
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

      {tab === "grants" &&
        (grants.length === 0 ? (
          <Empty
            dense
            icon="shield-check"
            title="No standing approvals"
            body='When you approve a request "and for a week", it shows up here until it lapses or you withdraw it.'
          />
        ) : (
          <Card
            title="Standing approvals"
            subtitle="Actions an agent may take without asking, for a limited time"
          >
            <div style={{ display: "grid", gap: 10 }}>
              {grants.map((g) => (
                <div
                  key={g.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: 10,
                  }}
                >
                  <span aria-hidden>{g.agentAvatar}</span>
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1, minWidth: 0 }}>
                    <Link href={`/agents/${g.agentId}`} data-plain>
                      {g.agentName}
                    </Link>{" "}
                    may run <code style={{ fontFamily: "var(--font-mono)" }}>{g.toolName}</code> unasked
                    {g.grantedByName ? ` — granted by ${g.grantedByName}` : ""}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    lapses {relative(g.expiresAt, now)}
                  </span>
                  {canReview && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(() => revokeApprovalGrantAction(g.id))}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
    </div>
  );
}
