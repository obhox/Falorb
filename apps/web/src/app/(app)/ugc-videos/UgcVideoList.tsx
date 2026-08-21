"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Icon, Input, Select } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { createUgcVideo } from "@/server/actions/ugc-videos";
import { useAction } from "@/lib/use-action";
import { relative, duration } from "@/lib/format";

const ELEVENLABS_NOTICE =
  "Connect ElevenLabs under Settings → Integrations before generating a video — each org uses its own account.";

export interface UgcVideoListItem {
  id: string;
  projectId: number | null;
  projectName: string | null;
  brief: string;
  status: string;
  lastError: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

const NO_PROJECT = "No property";

const STATUS_TONE: Record<string, "neutral" | "accent" | "up" | "down" | "warn"> = {
  pending: "neutral",
  script_ready: "accent",
  voice_ready: "accent",
  video_processing: "warn",
  ready: "up",
  failed: "down",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  script_ready: "Writing voiceover",
  voice_ready: "Rendering video",
  video_processing: "Rendering video",
  ready: "Ready",
  failed: "Failed",
};

/**
 * Org-wide UGC video generation. See `apps/web/src/app/(app)/ugc-videos/page.tsx`
 * for why this is a top-level route rather than a per-project tab.
 */
export function UgcVideoList({
  videos,
  projects,
  elevenlabsConnected,
}: {
  videos: UgcVideoListItem[];
  projects: { id: number; name: string }[];
  elevenlabsConnected: boolean;
}) {
  return (
    <>
      <CreateForm projects={projects} elevenlabsConnected={elevenlabsConnected} />

      {videos.length === 0 ? (
        <Empty
          icon="clapperboard"
          title="No UGC videos yet"
          body="Describe a product or offer above to generate your first script, voiceover, and talking video."
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

function CreateForm({
  projects,
  elevenlabsConnected,
}: {
  projects: { id: number; name: string }[];
  elevenlabsConnected: boolean;
}) {
  const [brief, setBrief] = useState("");
  const [projectName, setProjectName] = useState(NO_PROJECT);
  const [voiceId, setVoiceId] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, pending } = useAction();

  const projectByName = new Map(projects.map((p) => [p.name, p.id]));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    const data = new FormData();
    data.set("brief", brief);
    data.set("voiceId", voiceId);
    const projectId = projectByName.get(projectName);
    if (projectId) data.set("projectId", String(projectId));
    data.set("presenterImage", file);

    const result = await run(() => createUgcVideo(data), { quiet: true });
    if (result?.ok) {
      setBrief("");
      setVoiceId("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card title="Generate a UGC video" subtitle="Script, voiceover, and a lip-synced talking video">
      {!elevenlabsConnected && (
        <p
          style={{
            margin: "0 0 var(--space-5)",
            padding: "8px 10px",
            borderRadius: "var(--radius-control)",
            background: "var(--signal-warn-dim)",
            color: "var(--signal-warn)",
            fontSize: "var(--size-body-sm)",
          }}
        >
          {ELEVENLABS_NOTICE}
        </p>
      )}
      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-5)" }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span
            style={{
              fontSize: "var(--size-label)",
              color: "var(--text-secondary)",
              fontWeight: "var(--wt-medium)",
            }}
          >
            Brief
          </span>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="A skincare serum for combination skin — highlight the 2-week results and the no-fragrance formula."
            rows={3}
            maxLength={2000}
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-5)" }}>
          {projects.length > 0 && (
            <Select
              value={projectName}
              options={[NO_PROJECT, ...projects.map((p) => p.name)]}
              onChange={setProjectName}
            />
          )}
          <Input
            value={voiceId}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVoiceId(e.target.value)}
            placeholder="Voice ID — from your ElevenLabs voice library"
            mono
          />
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span
            style={{
              fontSize: "var(--size-label)",
              color: "var(--text-secondary)",
              fontWeight: "var(--wt-medium)",
            }}
          >
            Presenter photo
          </span>
          <input ref={fileRef} type="file" accept="image/*" required />
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            A clear, front-facing photo of the person who should deliver the script.
          </span>
        </label>

        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !brief.trim() || !voiceId.trim() || !elevenlabsConnected}
            iconLeft={<Icon name="sparkles" size={14} />}
          >
            {pending ? "Starting" : "Generate video"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VideoCard({ video }: { video: UgcVideoListItem }) {
  return (
    <Card>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{video.brief}</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                {video.projectName ?? "No property"} · {relative(video.createdAt)}
                {video.durationSeconds ? ` · ${duration(video.durationSeconds)}` : ""}
              </span>
            </div>
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
            style={{ width: "100%", maxWidth: 360, borderRadius: "var(--radius-2)" }}
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
