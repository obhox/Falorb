"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Checkbox, DataTable, Input, Select, Tabs } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import {
  retireAgentAction,
  runAgentNowAction,
  setAgentStatusAction,
  updateAgentAction,
} from "@/server/actions/agents";
import { money, relative } from "@/lib/format";

export interface DetailAgent {
  id: string;
  name: string;
  roleTitle: string;
  avatar: string;
  instructions: string;
  role: string;
  autonomy: string;
  status: string;
  toolkits: string[];
  projectIds: number[];
  scheduleMinutes: number | null;
  scheduleObjective: string | null;
  maxStepsPerRun: number;
  dailyRunLimit: number;
  unattended: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface RunSummary {
  id: string;
  trigger: string;
  objective: string;
  status: string;
  summary: string | null;
  error: string | null;
  stepCount: number;
  costUsd: number;
  tokens: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface MemoryRow {
  key: string;
  scope: string;
  content: string;
  importance: number;
  updatedAt: string;
}

const RUN_TONE: Record<string, "up" | "down" | "warn" | "neutral" | "accent"> = {
  succeeded: "up",
  failed: "down",
  waiting_approval: "warn",
  running: "accent",
  queued: "neutral",
  cancelled: "neutral",
};

const AUTONOMY_COPY: Record<string, string> = {
  observer: "Reads and reports. Changes nothing, anywhere.",
  assisted: "Reads freely. Every change waits for you to approve it.",
  autonomous:
    "Works on its own inside Falorb. Anything reaching a customer or another system still asks you first.",
};

const SHIFT_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "Only when asked", minutes: null },
  { label: "Every 30 minutes", minutes: 30 },
  { label: "Hourly", minutes: 60 },
  { label: "Every 4 hours", minutes: 240 },
  { label: "Every 8 hours", minutes: 480 },
  { label: "Twice a day", minutes: 720 },
  { label: "Daily", minutes: 1440 },
  { label: "Weekly", minutes: 10_080 },
];

export function AgentDetail({
  agent,
  runs,
  memories,
  projects,
  toolkits,
  roles,
  canManage,
  canRun,
  viewerIsOwner,
  now,
}: {
  agent: DetailAgent;
  runs: RunSummary[];
  memories: MemoryRow[];
  projects: { id: number; slug: string }[];
  toolkits: { key: string; label: string; description: string }[];
  roles: string[];
  canManage: boolean;
  canRun: boolean;
  viewerIsOwner: boolean;
  now: number;
}) {
  const [tab, setTab] = useState("shifts");
  const { run, pending } = useAction();

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Badge tone={agent.status === "active" ? "up" : "neutral"} dot>
          {agent.status === "active" ? "on shift" : agent.status}
        </Badge>
        <Badge tone={agent.autonomy === "autonomous" ? "warn" : "accent"}>{agent.autonomy}</Badge>
        <Badge tone="neutral">{agent.role}</Badge>
        {agent.unattended && <Badge tone="down">no approval gate</Badge>}
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
          {agent.nextRunAt && agent.status === "active"
            ? `Next shift ${relative(agent.nextRunAt, now)}`
            : agent.scheduleMinutes === null
              ? "No standing shift"
              : "Paused"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {canRun && (
            <Button
              size="sm"
              variant="accent"
              disabled={pending || agent.status !== "active"}
              onClick={() => void run(() => runAgentNowAction(agent.id))}
            >
              Run a shift now
            </Button>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                void run(() =>
                  setAgentStatusAction(agent.id, agent.status === "active" ? "paused" : "active"),
                )
              }
            >
              {agent.status === "active" ? "Pause" : "Resume"}
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "shifts", label: "Shifts", count: runs.length },
          { value: "brief", label: "Brief" },
          { value: "powers", label: "Permissions" },
          { value: "memory", label: "Memory", count: memories.length },
        ]}
      />

      {tab === "shifts" && (
        <Card
          title="Shift history"
          subtitle="Every run, what it cost, and what it reported"
        >
          <DataTable
            dense
            columns={[
              {
                key: "status",
                header: "",
                width: "110px",
                render: (r: RunSummary) => (
                  <Badge tone={RUN_TONE[r.status] ?? "neutral"}>{r.status.replace("_", " ")}</Badge>
                ),
              },
              {
                key: "summary",
                header: "Report",
                width: "minmax(240px, 3fr)",
                render: (r: RunSummary) => (
                  <Link
                    href={`/agents/${agent.id}/runs/${r.id}`}
                    data-plain
                    style={{ color: "var(--text-primary)" }}
                  >
                    {r.summary ?? r.error ?? r.objective}
                  </Link>
                ),
              },
              {
                key: "trigger",
                header: "Trigger",
                width: "90px",
                render: (r: RunSummary) => r.trigger,
              },
              { key: "stepCount", header: "Steps", width: "60px", align: "right", mono: true },
              {
                key: "cost",
                header: "Cost",
                width: "80px",
                align: "right",
                mono: true,
                render: (r: RunSummary) => (r.costUsd > 0 ? money(r.costUsd) : "—"),
              },
              {
                key: "createdAt",
                header: "When",
                width: "90px",
                align: "right",
                mono: true,
                render: (r: RunSummary) => relative(r.createdAt, now),
              },
            ]}
            rows={runs}
            emptyState={
              <Empty
                dense
                icon="clock"
                title="No shifts yet"
                body="Give it a schedule, assign it a task, or press “Run a shift now”."
              />
            }
          />
        </Card>
      )}

      {tab === "brief" && (
        <BriefEditor agent={agent} canManage={canManage} pending={pending} run={run} />
      )}

      {tab === "powers" && (
        <PowersEditor
          agent={agent}
          projects={projects}
          toolkits={toolkits}
          roles={roles}
          canManage={canManage}
          viewerIsOwner={viewerIsOwner}
          pending={pending}
          run={run}
        />
      )}

      {tab === "memory" && (
        <Card
          title="What it has learned"
          subtitle="Its own notes, carried between shifts. It writes and corrects these itself."
        >
          <DataTable
            dense
            columns={[
              { key: "scope", header: "Kind", width: "90px" },
              { key: "key", header: "Note", width: "180px", mono: true },
              {
                key: "content",
                header: "",
                width: "minmax(240px, 3fr)",
                render: (m: MemoryRow) => m.content,
              },
              { key: "importance", header: "Weight", width: "60px", align: "right", mono: true },
              {
                key: "updatedAt",
                header: "Updated",
                width: "90px",
                align: "right",
                mono: true,
                render: (m: MemoryRow) => relative(m.updatedAt, now),
              },
            ]}
            rows={memories}
            emptyState={
              <Empty
                dense
                icon="brain"
                title="Nothing remembered yet"
                body="It writes a note when it reaches a conclusion worth keeping — usually after a few shifts."
              />
            }
          />
        </Card>
      )}
    </div>
  );
}

function BriefEditor({
  agent,
  canManage,
  pending,
  run,
}: {
  agent: DetailAgent;
  canManage: boolean;
  pending: boolean;
  run: ReturnType<typeof useAction>["run"];
}) {
  const [roleTitle, setRoleTitle] = useState(agent.roleTitle);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [objective, setObjective] = useState(agent.scheduleObjective ?? "");
  const [shift, setShift] = useState(
    SHIFT_OPTIONS.find((o) => o.minutes === agent.scheduleMinutes)?.label ?? "Only when asked",
  );

  const dirty =
    roleTitle !== agent.roleTitle ||
    instructions !== agent.instructions ||
    objective !== (agent.scheduleObjective ?? "") ||
    (SHIFT_OPTIONS.find((o) => o.label === shift)?.minutes ?? null) !== agent.scheduleMinutes;

  return (
    <Card
      title="Brief"
      subtitle="What this agent is for, in your words. It becomes their standing instructions verbatim."
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Input
          label="Job title"
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
          disabled={!canManage}
        />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Standing instructions</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={!canManage}
            rows={16}
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

        <Select
          label="Shift"
          value={shift}
          options={SHIFT_OPTIONS.map((o) => o.label)}
          onChange={setShift}
        />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            What to do each shift, when nothing specific has been assigned
          </span>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            disabled={!canManage}
            rows={3}
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

        {canManage && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              size="sm"
              variant="primary"
              disabled={pending || !dirty}
              onClick={() => {
                const formData = new FormData();
                formData.set("roleTitle", roleTitle);
                formData.set("instructions", instructions);
                formData.set("scheduleObjective", objective);
                formData.set(
                  "scheduleMinutes",
                  String(SHIFT_OPTIONS.find((o) => o.label === shift)?.minutes ?? ""),
                );
                void run(() => updateAgentAction(agent.id, formData));
              }}
            >
              Save brief
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function PowersEditor({
  agent,
  projects,
  toolkits,
  roles,
  canManage,
  viewerIsOwner,
  pending,
  run,
}: {
  agent: DetailAgent;
  projects: { id: number; slug: string }[];
  toolkits: { key: string; label: string; description: string }[];
  roles: string[];
  canManage: boolean;
  viewerIsOwner: boolean;
  pending: boolean;
  run: ReturnType<typeof useAction>["run"];
}) {
  const [role, setRole] = useState(agent.role);
  const [autonomy, setAutonomy] = useState(agent.autonomy);
  const [enabled, setEnabled] = useState<string[]>(agent.toolkits);
  const [scope, setScope] = useState<number[]>(agent.projectIds);
  const [unattended, setUnattended] = useState(agent.unattended);
  const [steps, setSteps] = useState(String(agent.maxStepsPerRun));
  const [shifts, setShifts] = useState(String(agent.dailyRunLimit));

  const toggle = (list: string[], key: string) =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <Card
        title="Permissions"
        subtitle="The same four roles your human colleagues have, and they mean the same thing."
      >
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <Select
            label="Permission level"
            value={role}
            options={roles}
            onChange={setRole}
            style={{ maxWidth: 220 }}
          />
          <Select
            label="Autonomy"
            value={autonomy}
            options={["observer", "assisted", "autonomous"]}
            onChange={setAutonomy}
            style={{ maxWidth: 220 }}
          />
          <p style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            {AUTONOMY_COPY[autonomy]}
          </p>

          {viewerIsOwner && (
            <Checkbox
              checked={unattended}
              onChange={setUnattended}
              label="Let it act with no approvals at all"
              description="Removes the gate on actions that reach customers and other systems. Only an owner can set this, and only for an agent whose shifts you have already read."
            />
          )}
        </div>
      </Card>

      <Card title="Skills" subtitle="Which tools it can reach for. This is what makes it a growth analyst rather than a support lead.">
        <div style={{ display: "grid", gap: 10 }}>
          {toolkits.map((t) => (
            <Checkbox
              key={t.key}
              checked={enabled.includes(t.key)}
              onChange={() => setEnabled((prev) => toggle(prev, t.key))}
              label={t.label}
              description={t.description}
              disabled={!canManage}
            />
          ))}
        </div>
      </Card>

      <Card title="Scope and budget" subtitle="What it can see, and how much it may spend doing it.">
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Properties — none selected means the whole portfolio
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {projects.map((p) => {
                const on = scope.includes(p.id);
                return (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={on ? "primary" : "ghost"}
                    disabled={!canManage}
                    onClick={() =>
                      setScope((prev) =>
                        prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                      )
                    }
                  >
                    {p.slug}
                  </Button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Input
              label="Turns per shift"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              mono
              disabled={!canManage}
              style={{ maxWidth: 180 }}
              hint="1–40 · one turn may call several tools"
            />
            <Input
              label="Shifts per day"
              value={shifts}
              onChange={(e) => setShifts(e.target.value)}
              mono
              disabled={!canManage}
              style={{ maxWidth: 160 }}
              hint="Hard ceiling, rolling 24h"
            />
          </div>
        </div>
      </Card>

      {canManage && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => void run(() => retireAgentAction(agent.id))}
          >
            Retire this agent
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => {
              const formData = new FormData();
              formData.set("role", role);
              formData.set("autonomy", autonomy);
              formData.set("maxStepsPerRun", steps);
              formData.set("dailyRunLimit", shifts);
              // Appending nothing still marks the field present via the
              // sentinel below, so clearing every toolkit is expressible —
              // `formData.has` would otherwise read an empty selection as
              // "leave unchanged".
              formData.append("toolkits", "");
              for (const key of enabled) formData.append("toolkits", key);
              formData.append("projectIds", "");
              for (const id of scope) formData.append("projectIds", String(id));
              if (viewerIsOwner) formData.set("autoApproveAll", unattended ? "on" : "off");
              void run(() => updateAgentAction(agent.id, formData));
            }}
          >
            Save permissions
          </Button>
        </div>
      )}
    </div>
  );
}
