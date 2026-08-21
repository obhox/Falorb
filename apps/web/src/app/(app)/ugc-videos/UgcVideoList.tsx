"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Icon, Select } from "@falorb/ui";
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
  mode: string;
  brief: string;
  status: string;
  lastError: string | null;
  videoUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
}

export interface VoiceOption {
  voiceId: string;
  name: string;
  category: string;
}

const NO_PROJECT = "No property";
const AUTO_VOICE = "Auto — let Falorb pick";

const MODE_LABEL: Record<string, string> = {
  avatar: "Talking presenter",
  text_to_video: "AI text-to-video",
};

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
  voices,
  elevenlabsConnected,
}: {
  videos: UgcVideoListItem[];
  projects: { id: number; name: string }[];
  voices: VoiceOption[];
  elevenlabsConnected: boolean;
}) {
  return (
    <>
      <CreateForm projects={projects} voices={voices} elevenlabsConnected={elevenlabsConnected} />

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

const MODES = ["avatar", "text_to_video"] as const;
type Mode = (typeof MODES)[number];

function CreateForm({
  projects,
  voices,
  elevenlabsConnected,
}: {
  projects: { id: number; name: string }[];
  voices: VoiceOption[];
  elevenlabsConnected: boolean;
}) {
  const [brief, setBrief] = useState("");
  const [projectName, setProjectName] = useState(NO_PROJECT);
  const [mode, setMode] = useState<Mode>("avatar");
  const [voiceName, setVoiceName] = useState(AUTO_VOICE);
  const [hasFile, setHasFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, pending } = useAction();

  const projectByName = new Map(projects.map((p) => [p.name, p.id]));
  const voiceByName = new Map(voices.map((v) => [v.name, v.voiceId]));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (mode === "avatar" && !file) return;

    const data = new FormData();
    data.set("brief", brief);
    data.set("mode", mode);
    const voiceId = voiceByName.get(voiceName);
    if (mode === "avatar" && voiceId) data.set("voiceId", voiceId);
    const projectId = projectByName.get(projectName);
    if (projectId) data.set("projectId", String(projectId));
    if (file) data.set("presenterImage", file);

    const result = await run(() => createUgcVideo(data), { quiet: true });
    if (result?.ok) {
      setBrief("");
      setVoiceName(AUTO_VOICE);
      setHasFile(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const canSubmit = brief.trim() && elevenlabsConnected && (mode === "text_to_video" || hasFile);

  return (
    <Card title="Generate a UGC video" subtitle="A UGC video doesn't need a face — pick a talking presenter or pure AI text-to-video">
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
            Style
          </span>
          <Select
            value={MODE_LABEL[mode]!}
            options={MODES.map((m) => MODE_LABEL[m]!)}
            onChange={(label: string) => {
              const next = (Object.keys(MODE_LABEL) as Mode[]).find((m) => MODE_LABEL[m] === label);
              if (next) setMode(next);
            }}
          />
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            {mode === "avatar"
              ? "A presenter photo animated to lip-sync a generated voiceover."
              : "No photo needed — the AI model generates its own scene and narration from the brief."}
          </span>
        </label>

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
          {mode === "avatar" && (
            <Select
              value={voiceName}
              options={[AUTO_VOICE, ...voices.map((v) => v.name)]}
              onChange={setVoiceName}
            />
          )}
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span
            style={{
              fontSize: "var(--size-label)",
              color: "var(--text-secondary)",
              fontWeight: "var(--wt-medium)",
            }}
          >
            {mode === "avatar" ? "Presenter photo" : "Reference image (optional)"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            required={mode === "avatar"}
            onChange={() => setHasFile(!!fileRef.current?.files?.length)}
          />
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            {mode === "avatar"
              ? "A clear, front-facing photo of the person who should deliver the script."
              : "Optional — a product or subject photo for the model to feature. Leave empty to let it invent the scene."}
          </span>
        </label>

        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !canSubmit}
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
                {MODE_LABEL[video.mode] ?? video.mode} · {video.projectName ?? "No property"} ·{" "}
                {relative(video.createdAt)}
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
