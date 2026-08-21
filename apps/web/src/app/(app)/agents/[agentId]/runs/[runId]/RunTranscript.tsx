"use client";

import { useState } from "react";
import { Badge, Card, Icon } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { durationMs } from "@/lib/format";

export interface TranscriptStep {
  id: string;
  position: number;
  kind: string;
  content: string | null;
  toolName: string | null;
  arguments: unknown;
  result: unknown;
  ok: boolean | null;
  durationMs: number | null;
}

const KIND_LABEL: Record<string, string> = {
  assistant: "thought",
  tool_call: "action",
  tool_result: "result",
  approval: "asked permission",
  error: "error",
};

const KIND_ICON: Record<string, string> = {
  assistant: "message-square",
  tool_call: "play",
  tool_result: "corner-down-right",
  approval: "shield-check",
  error: "triangle-alert",
};

/**
 * The step-by-step record.
 *
 * Collapsed by default and expandable per step: the arguments and raw
 * results are the evidence, but they are not what you read first. Someone
 * opening this page is usually checking one specific thing an agent claimed,
 * and a wall of JSON makes that harder rather than easier.
 */
export function RunTranscript({ steps }: { steps: TranscriptStep[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (!steps.length) {
    return (
      <Card title="Transcript">
        <Empty
          dense
          icon="list"
          title="Nothing recorded"
          body="This shift has not started yet, or it failed before its first step."
        />
      </Card>
    );
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card title="Transcript" subtitle="Every step, in order — what it thought, what it did, what came back">
      <div style={{ display: "grid", gap: 2 }}>
        {steps.map((step) => {
          const expanded = open.has(step.id);
          const hasDetail = step.arguments != null || step.result != null;
          return (
            <div
              key={step.id}
              style={{
                borderTop: "1px solid var(--border-subtle)",
                padding: "10px 0",
              }}
            >
              <button
                type="button"
                onClick={() => hasDetail && toggle(step.id)}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: hasDetail ? "pointer" : "default",
                  color: "inherit",
                  font: "inherit",
                }}
              >
                <span style={{ marginTop: 2, opacity: 0.7 }}>
                  <Icon name={KIND_ICON[step.kind] ?? "circle"} size={13} />
                </span>
                <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {KIND_LABEL[step.kind] ?? step.kind}
                    </span>
                    {step.toolName && (
                      <Badge tone={step.ok === false ? "down" : "neutral"} mono>
                        {step.toolName}
                      </Badge>
                    )}
                    {step.durationMs !== null && (
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {durationMs(step.durationMs)}
                      </span>
                    )}
                  </div>
                  {step.content && (
                    <p
                      style={{
                        fontSize: 13,
                        lineHeight: 1.6,
                        color:
                          step.kind === "error" ? "var(--text-danger, #d66)" : "var(--text-secondary)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {step.content}
                    </p>
                  )}
                </div>
                {hasDetail && (
                  <span style={{ opacity: 0.5, marginTop: 2 }}>
                    <Icon name={expanded ? "chevron-up" : "chevron-down"} size={13} />
                  </span>
                )}
              </button>

              {expanded && (
                <div style={{ display: "grid", gap: 8, marginTop: 8, paddingLeft: 23 }}>
                  {step.arguments != null && (
                    <Payload label="Arguments" value={step.arguments} />
                  )}
                  {step.result != null && <Payload label="Result" value={step.result} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
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
          maxHeight: 320,
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
