"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Dialog, Icon, Input, Select, Tabs } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { createTaskAction, setTaskStatusAction } from "@/server/actions/tasks";
import { relative } from "@/lib/format";

export interface BoardTask {
  id: string;
  title: string;
  body: string | null;
  status: string;
  priority: string;
  assigneeType: string;
  assigneeName: string | null;
  assigneeAvatar: string | null;
  creatorType: string;
  creatorAgentName: string | null;
  handoffReason: string | null;
  dueAt: string | null;
  createdAt: string;
}

export interface AssigneeOption {
  id: string;
  label: string;
}

const COLUMNS: { status: string; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "blocked", label: "Blocked" },
  { status: "review", label: "Review" },
];

const PRIORITY_TONE: Record<string, "down" | "warn" | "neutral"> = {
  urgent: "down",
  high: "warn",
  normal: "neutral",
  low: "neutral",
};

const UNASSIGNED = "Unassigned";

export function TaskBoard({
  tasks,
  people,
  agents,
  projects,
  canManage,
  now,
}: {
  tasks: BoardTask[];
  people: AssigneeOption[];
  agents: AssigneeOption[];
  projects: { id: number; slug: string }[];
  canManage: boolean;
  now: number;
}) {
  const [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const { run, pending } = useAction();

  const visible = useMemo(() => {
    if (filter === "handoffs") return tasks.filter((t) => t.handoffReason);
    if (filter === "agents") return tasks.filter((t) => t.assigneeType === "agent");
    if (filter === "people") return tasks.filter((t) => t.assigneeType !== "agent");
    return tasks;
  }, [tasks, filter]);

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: "all", label: "Everything", count: tasks.length },
            {
              value: "handoffs",
              label: "Handed to a human",
              count: tasks.filter((t) => t.handoffReason).length,
            },
            {
              value: "agents",
              label: "With an agent",
              count: tasks.filter((t) => t.assigneeType === "agent").length,
            },
            {
              value: "people",
              label: "With people",
              count: tasks.filter((t) => t.assigneeType !== "agent").length,
            },
          ]}
        />
        {canManage && (
          <Button
            size="sm"
            variant="accent"
            style={{ marginLeft: "auto" }}
            onClick={() => setCreating(true)}
          >
            New task
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <Empty
          icon="square-check-big"
          title="Nothing open"
          body={
            filter === "handoffs"
              ? "No agent has handed anything over. When one hits something it cannot do, it lands here with the reason attached."
              : "The board is clear. Create a task, or assign one to an agent and it starts within a minute."
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gap: "var(--space-4)",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            alignItems: "start",
          }}
        >
          {COLUMNS.map((column) => {
            const inColumn = visible.filter((t) => t.status === column.status);
            return (
              <Card
                key={column.status}
                tone="panel"
                padding={12}
                title={column.label}
                subtitle={`${inColumn.length}`}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  {inColumn.length === 0 ? (
                    <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "6px 2px" }}>
                      Nothing here.
                    </p>
                  ) : (
                    inColumn.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        now={now}
                        canManage={canManage}
                        pending={pending}
                        onAdvance={(status) => void run(() => setTaskStatusAction(task.id, status))}
                      />
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating && (
        <NewTaskDialog
          people={people}
          agents={agents}
          projects={projects}
          pending={pending}
          onClose={() => setCreating(false)}
          onSubmit={async (formData) => {
            const result = await run(() => createTaskAction(formData));
            if (result?.ok) setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  now,
  canManage,
  pending,
  onAdvance,
}: {
  task: BoardTask;
  now: number;
  canManage: boolean;
  pending: boolean;
  onAdvance: (status: string) => void;
}) {
  return (
    <Card tone="card" padding={12}>
      <div style={{ display: "grid", gap: 8 }}>
        <Link
          href={`/tasks/${task.id}`}
          data-plain
          style={{ color: "var(--text-primary)", textDecoration: "none", fontSize: 13, lineHeight: 1.5 }}
        >
          {task.title}
        </Link>

        {task.handoffReason && (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "flex-start",
              fontSize: 11.5,
              lineHeight: 1.5,
              color: "var(--text-secondary)",
              background: "var(--surface-inset)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: 8,
            }}
          >
            <span style={{ marginTop: 1, opacity: 0.7 }}>
              <Icon name="hand" size={12} />
            </span>
            <span>
              {task.creatorAgentName ? `${task.creatorAgentName} ` : "An agent "}
              could not do this: {task.handoffReason}
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {task.priority !== "normal" && (
            <Badge tone={PRIORITY_TONE[task.priority] ?? "neutral"}>{task.priority}</Badge>
          )}
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {task.assigneeName
              ? `${task.assigneeAvatar ? `${task.assigneeAvatar} ` : ""}${task.assigneeName}`
              : "unassigned"}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
            {relative(task.createdAt, now)}
          </span>
        </div>

        {canManage && task.status !== "done" && (
          <div style={{ display: "flex", gap: 6 }}>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => onAdvance("done")}
              iconLeft={<Icon name="check" size={12} />}
            >
              Done
            </Button>
            {task.status !== "blocked" && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => onAdvance("blocked")}>
                Block
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * One assignee dropdown containing both people and agents.
 *
 * This is the smallest UI decision on the page and the most load-bearing
 * one: choosing who does a piece of work should not begin with choosing
 * *what kind of thing* does it. The value posted carries the kind
 * (`agent:<id>` / `user:<id>`), so the server keeps the distinction it needs
 * without the person making the decision having to think in those terms.
 */
function NewTaskDialog({
  people,
  agents,
  projects,
  pending,
  onClose,
  onSubmit,
}: {
  people: AssigneeOption[];
  agents: AssigneeOption[];
  projects: { id: number; slug: string }[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assigneeLabel, setAssigneeLabel] = useState(UNASSIGNED);
  const [projectSlug, setProjectSlug] = useState("None");

  const options = useMemo(() => {
    const map = new Map<string, string>([[UNASSIGNED, "unassigned"]]);
    for (const a of agents) map.set(a.label, `agent:${a.id}`);
    for (const p of people) map.set(p.label, `user:${p.id}`);
    return map;
  }, [agents, people]);

  return (
    <Dialog
      open
      title="New task"
      subtitle="Assign it to a person or an agent — the board treats them the same."
      width={540}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled={pending || !title.trim()}
            onClick={() => {
              const formData = new FormData();
              formData.set("title", title.trim());
              formData.set("body", body.trim());
              formData.set("priority", priority);
              formData.set("assignee", options.get(assigneeLabel) ?? "unassigned");
              const project = projects.find((p) => p.slug === projectSlug);
              if (project) formData.set("projectId", String(project.id));
              void onSubmit(formData);
            }}
          >
            Create
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing"
        />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Context — what “done” looks like, and anything already known
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            style={{
              width: "100%",
              resize: "vertical",
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-inset)",
              color: "var(--text-primary)",
              font: "inherit",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Select
            label="Assign to"
            value={assigneeLabel}
            options={[...options.keys()]}
            onChange={setAssigneeLabel}
            style={{ minWidth: 220 }}
          />
          <Select
            label="Priority"
            value={priority}
            options={["low", "normal", "high", "urgent"]}
            onChange={setPriority}
            style={{ minWidth: 140 }}
          />
          {projects.length > 0 && (
            <Select
              label="Property"
              value={projectSlug}
              options={["None", ...projects.map((p) => p.slug)]}
              onChange={setProjectSlug}
              style={{ minWidth: 160 }}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}
