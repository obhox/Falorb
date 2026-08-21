"use client";

import { useState } from "react";
import { Badge, Button, Card, Checkbox, Input, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";
import { composeSocialPost } from "@/server/actions/social";

export interface SocialChannelView {
  id: string;
  bufferId: string;
  service: string | null;
  displayName: string;
  isDisconnected: boolean;
  isQueuePaused: boolean;
  weeklyPostingLimit: number | null;
}

export interface SocialPostView {
  id: string;
  bufferId: string;
  channelBufferId: string;
  text: string | null;
  status: string | null;
  dueAt: string | null;
  sentAt: string | null;
  errorMessage: string | null;
  syncedAt: string;
}

/**
 * What Falorb asks Buffer to do with the post. Buffer's own wire values for
 * these differ by schema version, so the client maps them — see
 * `packages/buffer-client`.
 */
const MODES = [
  { value: "queue", label: "Add to queue", hint: "Next free slot in each channel's posting schedule." },
  { value: "schedule", label: "Schedule", hint: "Publishes at the time you pick below." },
  { value: "draft", label: "Save as draft", hint: "Stays unpublished in Buffer for someone to approve." },
  { value: "now", label: "Post now", hint: "Publishes immediately." },
] as const;

type ComposeMode = (typeof MODES)[number]["value"];

/** What Buffer says about this channel right now — why a channel can't be picked, or how much room its week has left. */
function channelDescription(channel: SocialChannelView): string | undefined {
  if (channel.isDisconnected) return "disconnected in Buffer";
  const parts = [channel.service, channel.isQueuePaused ? "queue paused" : null].filter(Boolean) as string[];
  if (channel.weeklyPostingLimit !== null) parts.push(`${channel.weeklyPostingLimit}/week limit`);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * Buffer's queue mirror plus a compose card. Nothing here posts
 * automatically — one explicit click per post, same posture as
 * `CrmActionsCard`'s manual Linki actions.
 */
export function SocialPanel({
  channels,
  posts,
  now,
}: {
  channels: SocialChannelView[];
  posts: SocialPostView[];
  now: number;
}) {
  const { run, pending } = useAction();
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueAt, setDueAt] = useState("");
  const [mode, setMode] = useState<ComposeMode>("queue");

  const channelById = new Map(channels.map((c) => [c.bufferId, c]));

  function toggle(channelId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  }

  async function submit() {
    const data = new FormData();
    data.set("text", text);
    data.set("mode", mode);
    if (mode === "schedule" && dueAt) data.set("dueAt", new Date(dueAt).toISOString());
    for (const channelId of selected) data.append("channelId", channelId);
    const result = await run(() => composeSocialPost(data));
    if (result?.ok) {
      setText("");
      setDueAt("");
      setSelected(new Set());
      setMode("queue");
    }
  }

  const modeHint = MODES.find((m) => m.value === mode)?.hint ?? "";
  const needsTime = mode === "schedule";
  const submitLabel = MODES.find((m) => m.value === mode)?.label ?? "Publish";

  return (
    <>
      <Card title="Compose" subtitle="Publishes through Buffer, to one or more connected channels">
        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
              Post text
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's happening?"
              rows={4}
              style={{
                resize: "vertical",
                padding: "8px 10px",
                borderRadius: "var(--radius-control)",
                background: "var(--surface-inset)",
                border: "1px solid var(--control-border)",
                boxShadow: "var(--edge-top)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans)",
                fontSize: "var(--size-body-sm)",
                letterSpacing: "var(--ls-body)",
              }}
            />
          </label>

          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
              Channels
            </span>
            {channels.length === 0 ? (
              <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>
                No channels synced yet — the mirror job runs every 15 minutes.
              </span>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {channels.map((c) => (
                  <Checkbox
                    key={c.id}
                    checked={selected.has(c.bufferId)}
                    onChange={() => toggle(c.bufferId)}
                    disabled={c.isDisconnected}
                    label={c.displayName}
                    description={channelDescription(c)}
                  />
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
              When
            </span>
            <Select
              size="sm"
              value={submitLabel}
              options={MODES.map((m) => m.label)}
              onChange={(label: string) => {
                const picked = MODES.find((m) => m.label === label);
                if (picked) setMode(picked.value);
              }}
            />
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{modeHint}</span>
          </div>

          {needsTime && (
            <Input
              type="datetime-local"
              label="Schedule for"
              value={dueAt}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDueAt(e.target.value)}
              hint="Buffer publishes at this time, in each channel's own timezone."
            />
          )}

          <Button
            variant="primary"
            disabled={pending || !text.trim() || selected.size === 0 || (needsTime && !dueAt)}
            onClick={submit}
          >
            {pending ? "Publishing…" : submitLabel}
          </Button>
        </div>
      </Card>

      <Card title="Recent posts" subtitle={`${posts.length} synced from Buffer`}>
        {posts.length === 0 ? (
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
            Nothing synced yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {posts.slice(0, 50).map((p) => {
              const channel = channelById.get(p.channelBufferId);
              return (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gap: 4,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Badge tone={p.status === "sent" ? "up" : p.status === "error" ? "down" : "neutral"}>
                      {p.status ?? "unknown"}
                    </Badge>
                    <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                      {channel?.displayName ?? p.channelBufferId}
                    </span>
                    <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                      {p.sentAt ? `sent ${relative(p.sentAt, now)}` : p.dueAt ? `due ${relative(p.dueAt, now)}` : ""}
                    </span>
                  </div>
                  {p.text && (
                    <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)", margin: 0 }}>{p.text}</p>
                  )}
                  {p.errorMessage && (
                    <p style={{ fontSize: "var(--size-micro)", color: "var(--signal-down)", margin: 0 }}>
                      Buffer: {p.errorMessage}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
