"use client";

import { useState } from "react";
import { Badge, Button, Card, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { setApprovalNotifyChannelAction, setAutomationPausedAction } from "@/server/actions/agents";
import { relative } from "@/lib/format";

export interface ChannelOption {
  id: string;
  name: string;
  kind: string;
}

const EMAIL_ONLY = "Owners and admins by email only";

/**
 * The workspace kill switch and where approvals get announced (FEATURES.md
 * §19). Two controls, on purpose on the same card: "stop everything" and
 * "make sure someone hears when an agent is waiting" are the two halves of
 * being able to leave agents running unattended.
 */
export function AutomationCard({
  paused,
  pausedAt,
  pausedByName,
  channels,
  notifyChannelId,
  canEdit,
  now,
}: {
  paused: boolean;
  pausedAt: string | null;
  pausedByName: string | null;
  channels: ChannelOption[];
  notifyChannelId: string | null;
  canEdit: boolean;
  now: number;
}) {
  const { run, pending } = useAction();

  // `Select` speaks labels, so build a label↔id map that survives two
  // channels sharing a name.
  const labelFor = (c: ChannelOption, i: number) =>
    channels.filter((o) => o.name === c.name).length > 1
      ? `${c.name} (${c.kind}, #${i + 1})`
      : `${c.name} (${c.kind})`;
  const labelled = channels.map((c, i) => ({ ...c, label: labelFor(c, i) }));
  const [channelLabel, setChannelLabel] = useState(
    labelled.find((c) => c.id === notifyChannelId)?.label ?? EMAIL_ONLY,
  );

  async function chooseChannel(label: string) {
    const previous = channelLabel;
    setChannelLabel(label);
    const id = labelled.find((c) => c.label === label)?.id ?? null;
    const result = await run(() => setApprovalNotifyChannelAction(id), { refresh: false });
    if (!result?.ok) setChannelLabel(previous);
  }

  return (
    <Card
      title="AI employees"
      subtitle="Stop every agent at once, and choose where you are told when one is waiting on you"
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 3, flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--text-primary)" }}>All automation</span>
              <Badge tone={paused ? "down" : "up"} dot>
                {paused ? "paused" : "running"}
              </Badge>
            </div>
            <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {paused
                ? `Paused ${pausedAt ? relative(pausedAt, now) : ""}${pausedByName ? ` by ${pausedByName}` : ""}. No agent will start a shift, a shift in progress stops at its next step, and approved actions wait. Nothing is discarded.`
                : "Pausing stops every agent in this workspace immediately — including approved actions that have not yet been carried out. Resume puts everything back where it was."}
            </span>
          </div>
          {canEdit && (
            <Button
              size="sm"
              variant={paused ? "accent" : "danger"}
              disabled={pending}
              onClick={() => void run(() => setAutomationPausedAction(!paused))}
            >
              {paused ? "Resume automation" : "Pause all automation"}
            </Button>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            borderTop: "1px solid var(--border-subtle)",
            paddingTop: 14,
          }}
        >
          <div style={{ display: "grid", gap: 3, flex: 1, minWidth: 240 }}>
            <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Announce waiting approvals</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Owners and admins are always emailed when an agent queues something for a decision.
              Pick an alert channel to post it to Slack or a webhook as well.
            </span>
          </div>
          {canEdit ? (
            <Select
              size="sm"
              value={channelLabel}
              options={[EMAIL_ONLY, ...labelled.map((c) => c.label)]}
              onChange={(v) => void chooseChannel(v)}
            />
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{channelLabel}</span>
          )}
        </div>
      </div>
    </Card>
  );
}
