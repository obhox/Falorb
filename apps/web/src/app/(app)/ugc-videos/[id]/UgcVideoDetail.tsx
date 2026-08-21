"use client";

import { useState } from "react";
import { getVideoModel } from "@falorb/elevenlabs-client/models";
import { Badge, Button, Card, Icon, Select } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { queueVideoForPosting, setPostQueueStatus } from "@/server/actions/ugc-videos";
import { useAction } from "@/lib/use-action";
import { shortDate } from "@/lib/format";

export interface UgcVideoDetailData {
  id: string;
  mode: string;
  brief: string;
  script: string | null;
  videoPrompt: string | null;
  voiceName: string | null;
  videoModel: string;
  aspectRatio: string | null;
  resolution: string | null;
  requestedDurationSecs: number | null;
  generateAudio: boolean;
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
      <Card title="Brief" action={<Recipe video={video} />}>
        <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{video.brief}</p>
      </Card>

      {/* Script and shot description are both "the words Falorb wrote", but
          they are not the same artefact and copying the wrong one into a
          caption is a real mistake — so each is labelled for what it is
          rather than sharing a generic heading. */}
      {video.script && (
        <Card title="Script" subtitle="What the presenter says, voiced by your ElevenLabs voice">
          <CopyField value={video.script} />
        </Card>
      )}

      {video.videoPrompt && (
        <Card title="Shot description" subtitle="What Falorb asked the model to film">
          <CopyField value={video.videoPrompt} />
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
            {STAGE_DETAIL[video.status] ?? "Still working on it."} Refresh this page in a minute or two.
          </p>
        </Card>
      )}

      {video.status === "ready" && video.videoUrl && (
        <Card
          title="Video"
          subtitle="Hosted by ElevenLabs, not re-hosted by Falorb — save anything you want to keep"
          action={
            /* Opened rather than downloaded: `download` is ignored on a
               cross-origin href, so a "Download" button would silently just
               navigate. Opening the original and letting the browser's own
               save do the rest is what actually happens either way. */
            <a href={video.videoUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary" iconLeft={<Icon name="external-link" size={13} />}>
                Open original
              </Button>
            </a>
          }
        >
          <video
            src={video.videoUrl}
            controls
            style={{
              width: "100%",
              maxWidth: 420,
              maxHeight: 420,
              borderRadius: "var(--radius-2)",
              background: "var(--ink-1000)",
            }}
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

/**
 * Which stage the chain is actually on, so a wait is legible rather than an
 * indefinite spinner. Keyed by the row's own resume point — the two modes
 * pass through different ones and neither needs to be mode-aware here.
 */
const STAGE_DETAIL: Record<string, string> = {
  pending: "Writing the words now.",
  script_ready: "Recording the voiceover on your ElevenLabs voice.",
  voice_ready: "Sending the photo and voiceover off to be lip-synced.",
  prompt_ready: "Sending the shot description off to the video model.",
  video_processing: "The model is rendering. This is the slow part.",
};

/**
 * The generation's settings, in the header of the brief it came from.
 * A finished video is judged against what it was asked to be — which model,
 * which voice, what shape — and none of that is recoverable from watching
 * the clip.
 */
function Recipe({ video }: { video: UgcVideoDetailData }) {
  const model = getVideoModel(video.videoModel);
  const isAvatar = video.mode === "avatar";

  const parts = [
    model?.label ?? video.videoModel,
    isAvatar ? video.voiceName ?? "voice by ID" : null,
    video.aspectRatio,
    video.resolution,
    video.requestedDurationSecs ? `${video.requestedDurationSecs}s` : null,
    !isAvatar && video.generateAudio ? "model audio" : null,
  ].filter(Boolean);

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Icon name={isAvatar ? "user-round" : "film"} size={13} color="var(--text-muted)" />
      <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{parts.join(" · ")}</span>
    </span>
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
