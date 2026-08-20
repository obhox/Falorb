"use client";

import Link from "next/link";
import { Badge, Card, Icon, IconButton } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { resolveEscalationAction } from "@/server/actions/support";
import { relative } from "@/lib/format";

export interface EscalationView {
  id: string;
  reason: string | null;
  summary: string | null;
  status: string | null;
  customerContact: string | null;
  personId: string | null;
  createdAt: string | null;
}

const STATUS_TONE: Record<string, "warn" | "neutral" | "up"> = {
  open: "warn",
  in_progress: "warn",
  resolved: "up",
};

/** Manual, per-escalation resolve — one click, same act as Bund AI's own dashboard. */
export function EscalationsPanel({
  escalations,
  connected,
  now,
}: {
  escalations: EscalationView[];
  connected: boolean;
  now: number;
}) {
  const { run, pending } = useAction();

  if (!connected) {
    return (
      <Card title="Support" subtitle="Bund AI escalations">
        <Empty
          icon="life-buoy"
          title="Bund AI isn't connected"
          body="Connect it in Settings → Integrations to see and resolve escalations here."
        />
      </Card>
    );
  }

  if (escalations.length === 0) {
    return (
      <Card title="Support" subtitle="Bund AI escalations">
        <Empty dense icon="life-buoy" title="No escalations" body="Nothing has been handed off to a human yet." />
      </Card>
    );
  }

  return (
    <Card title="Support" subtitle={`${escalations.filter((e) => e.status !== "resolved").length} open`}>
      <div className="falorb-scroll-x">
        <div style={{ display: "grid", gap: 1 }}>
          <div style={head}>
            <span>Status</span>
            <span>Reason</span>
            <span>Summary</span>
            <span>Contact</span>
            <span>Person</span>
            <span style={{ textAlign: "right" }}>Opened</span>
            <span />
          </div>

          {escalations.map((e) => {
            const resolved = e.status === "resolved";
            return (
              <div key={e.id} style={{ ...body, opacity: resolved ? 0.55 : 1 }}>
                <span>
                  <Badge tone={STATUS_TONE[e.status ?? ""] ?? "neutral"}>{e.status ?? "—"}</Badge>
                </span>
                <span style={cell}>{e.reason ?? "—"}</span>
                <span style={cell} title={e.summary ?? undefined}>
                  {e.summary ?? "—"}
                </span>
                <span style={cell}>{e.customerContact ?? "—"}</span>
                <span style={cell}>
                  {e.personId ? (
                    <Link href={`/people/${e.personId}`} style={{ color: "var(--text-primary)" }}>
                      view person
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                    textAlign: "right",
                  }}
                >
                  {e.createdAt ? relative(e.createdAt, now) : "—"}
                </span>
                <span style={{ display: "flex", justifyContent: "flex-end" }}>
                  {!resolved && (
                    <IconButton
                      size="sm"
                      label="Resolve"
                      icon={<Icon name="check" size={13} />}
                      disabled={pending}
                      onClick={() =>
                        void run(() => resolveEscalationAction(e.id), { success: "Resolved." })
                      }
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

const columns = "90px 110px minmax(0,1.4fr) minmax(0,1fr) 90px 90px 34px";

const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: columns,
  gap: 12,
  height: 30,
  alignItems: "center",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--size-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-label)",
  color: "var(--text-muted)",
  fontWeight: "var(--wt-medium)",
};

const body: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: columns,
  gap: 12,
  minHeight: "var(--row-height)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};

const cell: React.CSSProperties = {
  fontSize: "var(--size-body-sm)",
  color: "var(--text-body)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
