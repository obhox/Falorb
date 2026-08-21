"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { deleteTaskAction, updateTaskAction } from "@/server/actions/tasks";

const NO_PROJECT = "None";

/**
 * Editing a task after it exists — title, context, priority, due date,
 * property.
 *
 * Status and assignee are deliberately not here: both are single-click
 * controls elsewhere on the page, and duplicating them into a form with a
 * Save button would create two ways to change one thing that disagree about
 * whether the change has landed yet.
 */
export function TaskEditCard({
  taskId,
  title: initialTitle,
  body: initialBody,
  priority: initialPriority,
  projectId: initialProjectId,
  dueAt: initialDueAt,
  projects,
}: {
  taskId: string;
  title: string;
  body: string | null;
  priority: string;
  projectId: number | null;
  dueAt: string | null;
  projects: { id: number; slug: string }[];
}) {
  const router = useRouter();
  const { run, pending } = useAction();

  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody ?? "");
  const [priority, setPriority] = useState(initialPriority);
  const [dueAt, setDueAt] = useState(initialDueAt?.slice(0, 10) ?? "");
  const [projectSlug, setProjectSlug] = useState(
    projects.find((p) => p.id === initialProjectId)?.slug ?? NO_PROJECT,
  );

  const dirty =
    title !== initialTitle ||
    body !== (initialBody ?? "") ||
    priority !== initialPriority ||
    dueAt !== (initialDueAt?.slice(0, 10) ?? "") ||
    projectSlug !== (projects.find((p) => p.id === initialProjectId)?.slug ?? NO_PROJECT);

  return (
    <Card title="Edit" subtitle="Change what this task is asking for">
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Context</span>
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

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
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
              options={[NO_PROJECT, ...projects.map((p) => p.slug)]}
              onChange={setProjectSlug}
              style={{ minWidth: 160 }}
            />
          )}
          <Input
            label="Due"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            mono
            style={{ minWidth: 160 }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={async () => {
              const result = await run(() => deleteTaskAction(taskId), { refresh: false });
              if (result?.ok) router.push("/tasks");
            }}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !dirty}
            onClick={() => {
              const formData = new FormData();
              formData.set("title", title);
              formData.set("body", body);
              formData.set("priority", priority);
              formData.set("dueAt", dueAt);
              const project = projects.find((p) => p.slug === projectSlug);
              formData.set("projectId", project ? String(project.id) : "");
              void run(() => updateTaskAction(taskId, formData));
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}
