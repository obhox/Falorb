import Link from "next/link";
import { Badge, Card } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { relative } from "@/lib/format";

export interface ErrorLogItem {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  kind: string;
  toolName: string | null;
  message: string;
  objective: string;
  trigger: string;
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = {
  error: "run failed",
  tool_result: "tool failed",
  approval: "refused",
};

export function ErrorsLog({ errors, now }: { errors: ErrorLogItem[]; now: number }) {
  if (errors.length === 0) {
    return (
      <Empty
        icon="check"
        title="Nothing has gone wrong"
        body="When a shift throws, a tool call fails, or a request is refused, it lands here — across every agent, in one place, instead of only inside that run's transcript."
      />
    );
  }

  return (
    <Card title="Errors" subtitle="Every failure any agent has hit, most recent first">
      <div style={{ display: "grid", gap: 10 }}>
        {errors.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: 10,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1.4 }} aria-hidden>
              {item.agentAvatar}
            </span>
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Link
                  href={`/agents/${item.agentId}`}
                  data-plain
                  style={{ fontSize: 12.5, color: "var(--text-primary)" }}
                >
                  {item.agentName}
                </Link>
                <Badge tone="down">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                {item.toolName && (
                  <Badge tone="neutral" mono>
                    {item.toolName}
                  </Badge>
                )}
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {relative(item.createdAt, now)} · {item.trigger}
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--text-secondary)",
                }}
              >
                {item.message}
              </p>
              <Link
                href={`/agents/${item.agentId}/runs/${item.runId}`}
                data-plain
                style={{ fontSize: 11.5, color: "var(--text-muted)" }}
              >
                See the whole shift — {item.objective}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
