"use client";

import Link from "next/link";
import { getVideoModel } from "@falorb/elevenlabs-client/models";
import { Badge, Button, Card, Icon } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { relative, duration } from "@/lib/format";
import { UgcComposer } from "./UgcComposer";
import type { VoiceOption } from "./VoicePicker";

export interface UgcVideoListItem {
  id: string;
  projectId: number | null;
  projectName: string | null;
  mode: string;
  brief: string;
  voiceName: string | null;
  videoModel: string;
  aspectRatio: string | null;
  resolution: string | null;
  status: string;
  lastError: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "up" | "down" | "warn"> = {
  pending: "neutral",
  script_ready: "accent",
  voice_ready: "accent",
  prompt_ready: "accent",
  video_processing: "warn",
  ready: "up",
  failed: "down",
};

/**
 * Stage names a person recognises, not the resume points the column stores.
 * The two chains land on different ones — `script_ready` only ever happens
 * to an avatar video, `prompt_ready` only to a text-to-video one — so both
 * appear here and neither needs to know the row's mode to be labelled.
 */
const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  script_ready: "Recording voiceover",
  voice_ready: "Rendering video",
  prompt_ready: "Rendering video",
  video_processing: "Rendering video",
  ready: "Ready",
  failed: "Failed",
};

/**
 * Org-wide UGC video generation. See `apps/web/src/app/(app)/ugc-videos/page.tsx`
 * for why this is a top-level route rather than a per-project tab.
 *
 * The composer lives in `UgcComposer.tsx`; this file is the composer plus
 * the reel of what has been generated. Each card names the model and, for a
 * talking-avatar video, the voice — a library that mixes Veo b-roll with
 * lip-synced testimonials is unreadable if every card just says "video".
 */
export function UgcVideoList({
  videos,
  projects,
  voices,
  voiceError,
  elevenlabsConnected,
}: {
  videos: UgcVideoListItem[];
  projects: { id: number; name: string }[];
  voices: VoiceOption[];
  voiceError: string | null;
  elevenlabsConnected: boolean;
}) {
  return (
    <>
      <UgcComposer
        projects={projects}
        voices={voices}
        voiceError={voiceError}
        elevenlabsConnected={elevenlabsConnected}
      />

      {videos.length === 0 ? (
        <Empty
          icon="clapperboard"
          title="No videos yet"
          body="Describe a product or offer above. Pick a talking avatar to have a presenter deliver it, or text to video to have a model film it."
        />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </>
  );
}

function VideoCard({ video }: { video: UgcVideoListItem }) {
  const model = getVideoModel(video.videoModel);
  const isAvatar = video.mode === "avatar";

  // Everything the generation was actually configured with, in one line —
  // enough to tell two near-identical briefs apart at a glance.
  const specs = [
    model?.label ?? video.videoModel,
    isAvatar ? video.voiceName ?? "Voice by ID" : null,
    video.aspectRatio,
    video.resolution,
    video.durationSeconds ? duration(video.durationSeconds) : null,
  ].filter(Boolean);

  return (
    <Card>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon
                name={isAvatar ? "user-round" : "film"}
                size={13}
                color="var(--text-muted)"
              />
              <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                {isAvatar ? "Talking avatar" : "Text to video"}
              </span>
            </span>
            <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{video.brief}</p>
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              {specs.join(" · ")}
            </span>
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              {video.projectName ?? "No property"} · {relative(video.createdAt)}
            </span>
          </div>
          <Badge tone={STATUS_TONE[video.status] ?? "neutral"}>
            {STATUS_LABEL[video.status] ?? video.status}
          </Badge>
        </div>

        {video.status === "failed" && video.lastError && (
          <p style={{ fontSize: "var(--size-micro)", color: "var(--signal-down)" }}>{video.lastError}</p>
        )}

        {video.status === "ready" && video.videoUrl && (
          <video
            src={video.videoUrl}
            controls
            style={{
              width: "100%",
              // A 9:16 clip in a 360px-wide box is 640px tall and pushes
              // every later card off the screen, so the box is capped by
              // height and the element letterboxes itself inside it.
              maxWidth: 360,
              maxHeight: 320,
              borderRadius: "var(--radius-2)",
              background: "var(--ink-1000)",
            }}
          />
        )}

        {video.status === "ready" && (
          <div>
            <Link href={`/ugc-videos/${video.id}`}>
              <Button size="sm" variant="secondary">
                Review &amp; queue for posting
              </Button>
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}
