"use client";

import { useState } from "react";
import { Button, Card, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import {
  assignTaskAction,
  commentOnTaskAction,
  setTaskStatusAction,
} from "@/server/actions/tasks";
import { relative } from "@/lib/format";

export interface ThreadComment {
  id: string;
  authorType: string;
  author: string;
  avatar: string | null;
  body: string;
  createdAt: string;
}

const UNASSIGNED_LABEL = "Unassigned";

export function TaskThread({
  taskId,
  status,
  comments,
  assignees,
  currentAssignee,
  canManage,
  now,
}: {
  taskId: string;
  status: string;
  comments: ThreadComment[];
  assignees: { value: string; label: string }[];
  currentAssignee: string;
  canManage: boolean;
  now: number;
}) {
  const [draft, setDraft] = useState("");
  const { run, pending } = useAction();

  const options = [
    { value: "unassigned", label: UNASSIGNED_LABEL },
    ...assignees,
  ];
  const currentLabel =
    options.find((o) => o.value === currentAssignee)?.label ?? UNASSIGNED_LABEL;

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {canManage && (
        <Card tone="inset" padding={12}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Select
              label="Assigned to"
              value={currentLabel}
              options={options.map((o) => o.label)}
              onChange={(label) => {
                const next = options.find((o) => o.label === label);
                if (!next || next.value === currentAssignee) return;
                void run(() => assignTaskAction(taskId, next.value));
              }}
              style={{ minWidth: 240 }}
            />
            {status !== "done" && status !== "cancelled" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => void run(() => setTaskStatusAction(taskId, "done"))}
              >
                Mark done
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card title="Thread" subtitle="An agent reads all of this before it works the task">
        <div style={{ display: "grid", gap: 14 }}>
          {comments.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Nothing said yet.</p>
          )}
          {comments.map((comment) => (
            <div key={comment.id} style={{ display: "flex", gap: 10 }}>
              <span style={{ fontSize: 18, lineHeight: 1.2 }} aria-hidden>
                {comment.avatar ?? (comment.authorType === "system" ? "•" : "👤")}
              </span>
              <div style={{ minWidth: 0, flex: 1, display: "grid", gap: 3 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 12.5, fontWeight: "var(--wt-semibold)" }}>
                    {comment.author}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {relative(comment.createdAt, now)}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    lineHeight: 1.65,
                    color:
                      comment.authorType === "system"
                        ? "var(--text-muted)"
                        : "var(--text-secondary)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {comment.body}
                </p>
              </div>
            </div>
          ))}

          {canManage && (
            <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder="Add context, or redirect whoever is working this…"
                style={{
                  width: "100%",
                  resize: "vertical",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-inset)",
                  color: "var(--text-primary)",
                  font: "inherit",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending || !draft.trim()}
                  onClick={async () => {
                    const result = await run(() => commentOnTaskAction(taskId, draft));
                    if (result?.ok) setDraft("");
                  }}
                >
                  Comment
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
