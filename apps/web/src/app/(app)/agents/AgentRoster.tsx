"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Checkbox, Dialog, Icon, Input, Select } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import {
  hireAgentAction,
  runAgentNowAction,
  setAgentStatusAction,
  setAutomationPausedAction,
} from "@/server/actions/agents";
import { relative } from "@/lib/format";

export interface RosterAgent {
  id: string;
  name: string;
  roleTitle: string;
  avatar: string;
  role: string;
  autonomy: string;
  status: string;
  toolkits: string[];
  scheduleMinutes: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSummary: string | null;
  lastRunStatus: string | null;
  recentRuns: number;
  openTasks: number;
  pendingApprovals: number;
  /** Every approval gate waived — worth saying out loud on the card. */
  unattended: boolean;
}

export interface PresetOption {
  key: string;
  name: string;
  roleTitle: string;
  avatar: string;
  summary: string;
  toolkits: string[];
  scheduleMinutes: number | null;
}

export interface ToolkitOption {
  key: string;
  label: string;
  description: string;
}

const AUTONOMY_TONE: Record<string, "neutral" | "accent" | "warn"> = {
  observer: "neutral",
  assisted: "accent",
  autonomous: "warn",
};

function shiftLabel(minutes: number | null): string {
  if (minutes === null) return "on request only";
  if (minutes % 1440 === 0) return minutes === 1440 ? "daily" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "hourly" : `every ${minutes / 60} hours`;
  return `every ${minutes} min`;
}

export function AgentRoster({
  agents,
  presets,
  toolkits,
  projects,
  canManage,
  pendingApprovals,
  automationPaused,
  automationPausedAt,
  automationPausedBy,
  recentErrors,
  now,
}: {
  agents: RosterAgent[];
  presets: PresetOption[];
  toolkits: ToolkitOption[];
  projects: { id: number; slug: string }[];
  canManage: boolean;
  pendingApprovals: number;
  automationPaused: boolean;
  automationPausedAt: string | null;
  automationPausedBy: string | null;
  recentErrors: number;
  now: number;
}) {
  const [hiring, setHiring] = useState(false);
  const { run, pending } = useAction();

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      {automationPaused && (
        <Card tone="inset" padding={14}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="pause" size={15} />
            <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
              All automation is paused
              {automationPausedAt ? ` (${relative(automationPausedAt, now)}` : ""}
              {automationPausedBy ? `${automationPausedAt ? ", " : " ("}by ${automationPausedBy}` : ""}
              {automationPausedAt || automationPausedBy ? ")" : ""}. No agent will run and
              approved actions will not be carried out until it is resumed.
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="accent"
                disabled={pending}
                style={{ marginLeft: "auto" }}
                onClick={() => void run(() => setAutomationPausedAction(false))}
              >
                Resume automation
              </Button>
            )}
          </div>
        </Card>
      )}

      {pendingApprovals > 0 && (
        <Card tone="inset" padding={14}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="shield-check" size={15} />
            <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
              {pendingApprovals} action{pendingApprovals === 1 ? "" : "s"} waiting on a decision
              from you.
            </span>
            <Link href="/agents/approvals" style={{ marginLeft: "auto", textDecoration: "none" }}>
              <Button size="sm" variant="accent">
                Review
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {recentErrors > 0 && (
        <Card tone="inset" padding={14}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="triangle-alert" size={15} />
            <span style={{ fontSize: 13, color: "var(--text-primary)" }}>
              {recentErrors} error{recentErrors === 1 ? "" : "s"} in the last 24 hours.
            </span>
            <Link href="/agents/errors" style={{ marginLeft: "auto", textDecoration: "none" }}>
              <Button size="sm" variant="ghost">
                See errors
              </Button>
            </Link>
          </div>
        </Card>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 640 }}>
          Agents work the same task board your team does. Assign them work, read what they did, and
          approve anything that reaches a customer.
        </p>
        {canManage && (
          <Button size="sm" variant="accent" onClick={() => setHiring(true)}>
            Hire an agent
          </Button>
        )}
      </div>

      {agents.length === 0 ? (
        <Empty
          icon="users"
          title="No agents yet"
          body={
            canManage
              ? "Hire one from a preset — a growth analyst, an SDR, a support lead — then edit its brief. Every new agent starts assisted, so nothing happens without your say-so."
              : "Nobody has hired an agent for this workspace yet. An owner or admin can add one."
          }
          action={
            canManage ? (
              <Button size="sm" variant="accent" onClick={() => setHiring(true)}>
                Hire an agent
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gap: "var(--space-4)",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          }}
        >
          {agents.map((agent) => (
            <Card key={agent.id} tone="card" padding={16}>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 26, lineHeight: 1 }} aria-hidden>
                    {agent.avatar}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Link
                      href={`/agents/${agent.id}`}
                      data-plain
                      style={{ color: "var(--text-primary)", textDecoration: "none" }}
                    >
                      <span style={{ fontSize: 15, fontWeight: "var(--wt-semibold)" }}>
                        {agent.name}
                      </span>
                    </Link>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{agent.roleTitle}</div>
                  </div>
                  <Badge tone={agent.status === "active" ? "up" : "neutral"} dot>
                    {agent.status === "active" ? "on shift" : agent.status}
                  </Badge>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={AUTONOMY_TONE[agent.autonomy] ?? "neutral"}>{agent.autonomy}</Badge>
                  <Badge tone="neutral">{agent.role}</Badge>
                  <Badge tone="neutral" mono>
                    {shiftLabel(agent.scheduleMinutes)}
                  </Badge>
                  {agent.unattended && <Badge tone="down">unattended</Badge>}
                </div>

                <p
                  style={{
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "var(--text-secondary)",
                    minHeight: 34,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {agent.lastSummary ??
                    (agent.lastRunStatus === "failed"
                      ? "Its last shift failed — open it to see why."
                      : "No shifts yet.")}
                </p>

                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-muted)",
                  }}
                >
                  <span>{agent.recentRuns} shifts / 7d</span>
                  <span>{agent.openTasks} open tasks</span>
                  {agent.pendingApprovals > 0 && (
                    <span style={{ color: "var(--accent)" }}>
                      {agent.pendingApprovals} awaiting you
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: 12,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {agent.lastRunAt ? `Last ran ${relative(agent.lastRunAt, now)}` : "Never run"}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending || agent.status !== "active"}
                      onClick={() =>
                        void run(() => runAgentNowAction(agent.id), { success: "Queued." })
                      }
                    >
                      Run now
                    </Button>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          void run(() =>
                            setAgentStatusAction(
                              agent.id,
                              agent.status === "active" ? "paused" : "active",
                            ),
                          )
                        }
                      >
                        {agent.status === "active" ? "Pause" : "Resume"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {hiring && (
        <HireDialog
          presets={presets}
          toolkits={toolkits}
          projects={projects}
          pending={pending}
          onClose={() => setHiring(false)}
          onSubmit={async (formData) => {
            const result = await run(() => hireAgentAction(formData));
            if (result?.ok) setHiring(false);
          }}
        />
      )}
    </div>
  );
}

const MIN_INSTRUCTIONS = 20;

/**
 * Hiring, in one of two shapes.
 *
 * From a preset: pick the job and a name. Everything else — brief,
 * permission level, autonomy, schedule — comes from the preset and is
 * editable afterwards on the agent's own page. A twelve-field creation form
 * would put every decision in front of someone before they have seen the
 * agent do anything, which is the wrong order: you tune an employee after
 * watching them work, not before.
 *
 * From scratch: there is no preset to inherit from, so the fields a preset
 * would have supplied — name, title, brief, skills — are asked for
 * directly. Permission level, autonomy and schedule are deliberately left
 * off this form and default the same safe way a preset hire does (viewer,
 * assisted, on request only): the "tune after watching it work" principle
 * still holds, it just starts from the fields nothing else could infer.
 */
function HireDialog({
  presets,
  toolkits,
  projects,
  pending,
  onClose,
  onSubmit,
}: {
  presets: PresetOption[];
  toolkits: ToolkitOption[];
  projects: { id: number; slug: string }[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"preset" | "scratch">("preset");

  const [presetKey, setPresetKey] = useState(presets[0]?.key ?? "");
  const [name, setName] = useState(presets[0]?.name ?? "");

  const [scratchAvatar, setScratchAvatar] = useState("🤖");
  const [scratchName, setScratchName] = useState("");
  const [scratchTitle, setScratchTitle] = useState("");
  const [scratchInstructions, setScratchInstructions] = useState("");
  const [scratchToolkits, setScratchToolkits] = useState<string[]>([]);

  const [scope, setScope] = useState<number[]>([]);

  const preset = presets.find((p) => p.key === presetKey);

  const choose = (label: string) => {
    const next = presets.find((p) => `${p.avatar}  ${p.name} — ${p.roleTitle}` === label);
    if (!next) return;
    setPresetKey(next.key);
    setName(next.name);
  };

  const labelFor = (p: PresetOption) => `${p.avatar}  ${p.name} — ${p.roleTitle}`;

  const toggleToolkit = (key: string) =>
    setScratchToolkits((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const presetValid = Boolean(preset) && name.trim().length > 0;
  const scratchValid =
    scratchName.trim().length > 0 &&
    scratchName.trim().length <= 60 &&
    scratchTitle.trim().length > 0 &&
    scratchInstructions.trim().length >= MIN_INSTRUCTIONS &&
    scratchToolkits.length > 0;

  return (
    <Dialog
      open
      title="Hire an agent"
      subtitle={
        mode === "preset"
          ? "Pick the job. You can rewrite the brief and change permissions afterwards."
          : "Write the job yourself — its name, title and instructions. Permissions come after, once you've watched it work."
      }
      width={mode === "preset" ? 560 : 640}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled={pending || (mode === "preset" ? !presetValid : !scratchValid)}
            onClick={() => {
              const formData = new FormData();
              if (mode === "preset") {
                if (!preset) return;
                formData.set("preset", preset.key);
                formData.set("name", name.trim());
              } else {
                formData.set("name", scratchName.trim());
                formData.set("roleTitle", scratchTitle.trim());
                formData.set("instructions", scratchInstructions.trim());
                formData.set("avatar", scratchAvatar.trim() || "🤖");
                for (const key of scratchToolkits) formData.append("toolkits", key);
              }
              for (const id of scope) formData.append("projectIds", String(id));
              void onSubmit(formData);
            }}
          >
            Hire
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Button
            size="sm"
            variant={mode === "preset" ? "primary" : "ghost"}
            onClick={() => setMode("preset")}
          >
            From a preset
          </Button>
          <Button
            size="sm"
            variant={mode === "scratch" ? "primary" : "ghost"}
            onClick={() => setMode("scratch")}
          >
            From scratch
          </Button>
        </div>

        {mode === "preset" ? (
          <>
            <Select
              label="Job"
              value={preset ? labelFor(preset) : ""}
              options={presets.map(labelFor)}
              onChange={choose}
            />

            {preset && (
              <>
                <p style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-secondary)" }}>
                  {preset.summary}
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {preset.toolkits.map((t) => (
                    <Badge key={t} tone="neutral">
                      {t}
                    </Badge>
                  ))}
                </div>
              </>
            )}

            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What you will call them"
            />
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10 }}>
              <Input
                label="Avatar"
                value={scratchAvatar}
                onChange={(e) => setScratchAvatar(e.target.value)}
                placeholder="🤖"
                style={{ maxWidth: 80 }}
              />
              <Input
                label="Name"
                value={scratchName}
                onChange={(e) => setScratchName(e.target.value)}
                placeholder="What you will call them"
                style={{ flex: 1 }}
              />
            </div>

            <Input
              label="Job title"
              value={scratchTitle}
              onChange={(e) => setScratchTitle(e.target.value)}
              placeholder="e.g. Retention analyst"
            />

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Instructions — its whole job description, in your words
              </span>
              <textarea
                value={scratchInstructions}
                onChange={(e) => setScratchInstructions(e.target.value)}
                rows={10}
                placeholder="You are... Your job is... How to decide what matters... When to hand something to a person instead of acting..."
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
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {scratchInstructions.trim().length < MIN_INSTRUCTIONS
                  ? `At least ${MIN_INSTRUCTIONS} characters — this becomes its standing instructions verbatim.`
                  : "Becomes its standing instructions verbatim."}
              </span>
            </label>

            <div style={{ display: "grid", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Skills — what makes this a specific job rather than a generic one
              </span>
              <div style={{ display: "grid", gap: 10 }}>
                {toolkits.map((t) => (
                  <Checkbox
                    key={t.key}
                    checked={scratchToolkits.includes(t.key)}
                    onChange={() => toggleToolkit(t.key)}
                    label={t.label}
                    description={t.description}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Properties it can see — leave all unticked for the whole portfolio
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {projects.map((p) => {
              const on = scope.includes(p.id);
              return (
                <Button
                  key={p.id}
                  size="sm"
                  variant={on ? "primary" : "ghost"}
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

        <Card tone="inset" padding={12}>
          <p style={{ fontSize: 12, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            It starts <strong>assisted</strong>: it can read everything in scope, but every change
            it wants to make waits for you to approve it. Give it more rope once you have read a
            few of its shifts.
          </p>
        </Card>
      </div>
    </Dialog>
  );
}
