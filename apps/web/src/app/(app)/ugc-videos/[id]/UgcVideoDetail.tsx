"use client";

import { useState } from "react";
import { Badge, Button, Card, Select } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { queueVideoForPosting, setPostQueueStatus } from "@/server/actions/ugc-videos";
import { useAction } from "@/lib/use-action";
import { shortDate } from "@/lib/format";

export interface UgcVideoDetailData {
  id: string;
  brief: string;
  script: string | null;
  status: string;
  lastError: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
}

export interface PostQueueEntry {
  id: string;
  platform: string;
  caption: string | null;
  scheduledAt: string | null;
  status: string;
  createdAt: string;
}

const PLATFORMS = ["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn", "X", "Facebook"];

const QUEUE_TONE: Record<string, "neutral" | "up" | "down"> = {
  queued: "neutral",
  posted: "up",
  canceled: "down",
};

export function UgcVideoDetail({ video, queue }: { video: UgcVideoDetailData; queue: PostQueueEntry[] }) {
  return (
    <>
      <Card title="Brief">
        <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{video.brief}</p>
      </Card>

      {video.script && (
        <Card title="Script">
          <CopyField value={video.script} />
        </Card>
      )}

      {video.status === "failed" && (
        <Card title="Failed">
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--signal-down)" }}>
            {video.lastError ?? "This video failed to generate."}
          </p>
        </Card>
      )}

      {video.status !== "ready" && video.status !== "failed" && (
        <Card title="Generating">
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)" }}>
            Still working on it — refresh this page in a minute or two.
          </p>
        </Card>
      )}

      {video.status === "ready" && video.videoUrl && (
        <Card title="Video">
          <video
            src={video.videoUrl}
            controls
            style={{ width: "100%", maxWidth: 420, borderRadius: "var(--radius-2)" }}
          />
        </Card>
      )}

      {video.status === "ready" && <QueueForm videoId={video.id} />}

      {queue.length > 0 && (
        <Card title="Posting queue">
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {queue.map((entry) => (
              <QueueRow key={entry.id} entry={entry} videoId={video.id} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function QueueForm({ videoId }: { videoId: string }) {
  const [platform, setPlatform] = useState(PLATFORMS[0]!);
  const [caption, setCaption] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const { run, pending } = useAction();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const data = new FormData();
    data.set("platform", platform);
    data.set("caption", caption);
    data.set("scheduledAt", scheduledAt);
    const result = await run(() => queueVideoForPosting(videoId, data), { quiet: true, success: "Queued." });
    if (result?.ok) {
      setCaption("");
      setScheduledAt("");
    }
  }

  return (
    <Card title="Queue for posting" subtitle="Falorb doesn't post automatically yet — this is a to-do list for whoever publishes it">
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-5)" }}>
        <Select value={platform} options={PLATFORMS} onChange={setPlatform} />

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
            Caption
          </span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
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
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)", fontWeight: "var(--wt-medium)" }}>
            Target date (optional)
          </span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius-control)",
              background: "var(--surface-inset)",
              border: "1px solid var(--control-border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--size-body-sm)",
            }}
          />
        </label>

        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Queuing" : "Add to queue"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function QueueRow({ entry, videoId }: { entry: PostQueueEntry; videoId: string }) {
  const { run, pending } = useAction();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 0",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{entry.platform}</span>
        <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
          {entry.scheduledAt ? shortDate(entry.scheduledAt) : "No target date"}
          {entry.caption ? ` · ${entry.caption}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <Badge tone={QUEUE_TONE[entry.status] ?? "neutral"}>{entry.status}</Badge>
        {entry.status === "queued" && (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => setPostQueueStatus(entry.id, videoId, "posted"), { quiet: true })}
            >
              Mark posted
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => setPostQueueStatus(entry.id, videoId, "canceled"), { quiet: true })}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
