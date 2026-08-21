"use client";

import { useState } from "react";
import { Badge, Button, Card, Checkbox, Input } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";
import { composeSocialPost } from "@/server/actions/social";

export interface SocialChannelView {
  id: string;
  bufferId: string;
  service: string | null;
  displayName: string;
  isDisconnected: boolean;
}

export interface SocialPostView {
  id: string;
  bufferId: string;
  channelBufferId: string;
  text: string | null;
  status: string | null;
  dueAt: string | null;
  sentAt: string | null;
  syncedAt: string;
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
    if (dueAt) data.set("dueAt", new Date(dueAt).toISOString());
    for (const channelId of selected) data.append("channelId", channelId);
    const result = await run(() => composeSocialPost(data));
    if (result?.ok) {
      setText("");
      setDueAt("");
      setSelected(new Set());
    }
  }

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
                    description={c.isDisconnected ? "disconnected in Buffer" : (c.service ?? undefined)}
                  />
                ))}
              </div>
            )}
          </div>

          <Input
            type="datetime-local"
            label="Schedule for (optional)"
            value={dueAt}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDueAt(e.target.value)}
            hint="Leave blank to add to each channel's queue instead of a specific time."
          />

          <Button
            variant="primary"
            disabled={pending || !text.trim() || selected.size === 0}
            onClick={submit}
          >
            {pending ? "Publishing…" : dueAt ? "Schedule post" : "Add to queue"}
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
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
