"use client";

import { useMemo, useRef, useState } from "react";
import {
  DEFAULT_AVATAR_MODEL_ID,
  DEFAULT_PROMPT_MODEL_ID,
  videoModelsFor,
  type VideoModelInput,
  type VideoModelSpec,
} from "@falorb/elevenlabs-client/models";
import { Badge, Button, Card, Icon, Select, SegmentedControl, Switch } from "@falorb/ui";
import { createUgcVideo } from "@/server/actions/ugc-videos";
import { useAction } from "@/lib/use-action";
import { VoicePicker, type VoiceOption } from "./VoicePicker";

/**
 * The generation composer for `/ugc-videos`.
 *
 * Rewritten around what ElevenLabs' Flows video API actually offers rather
 * than around the one model Falorb shipped first. Flows has two shapes of
 * video model and they need different things from a person, so the form has
 * two modes:
 *
 *   Talking avatar  a photo of a presenter + a voice from the org's own
 *                   ElevenLabs library. Falorb writes the script, voices it,
 *                   and lip-syncs the photo to it.
 *   Text to video   no presenter and no voiceover. Falorb turns the brief
 *                   into a shot description and a text-to-video model (Veo,
 *                   Seedance) generates the footage, scoring its own audio.
 *
 * Everything below the mode switch is rendered from the chosen model's entry
 * in `VIDEO_MODELS` — which resolutions it offers, which aspect ratios,
 * which durations, whether it can generate audio. Nothing here hard-codes a
 * model's capabilities, so adding one to the catalog adds it to this form
 * with the right controls already attached, and no combination is offerable
 * that the API would reject. `createUgcVideo` re-derives the same rules
 * server-side; this is guidance, not the enforcement.
 *
 * Framing values are *clamped at render* rather than reset by an effect:
 * switching from Seedance (which does 3:4) to Veo (which does not) shows
 * Veo's own first ratio immediately, with no intermediate frame in an
 * invalid state and no effect racing the submit.
 */

const NO_PROJECT = "No property";

const MODE_LABELS: Record<string, VideoModelInput> = {
  "Talking avatar": "avatar",
  "Text to video": "prompt",
};
const MODE_OPTIONS = Object.keys(MODE_LABELS);

const MODE_BLURB: Record<VideoModelInput, string> = {
  avatar:
    "A person to camera. Falorb writes the script, voices it from your ElevenLabs library, and lip-syncs your presenter photo to it.",
  prompt:
    "No presenter needed. Falorb turns your brief into a shot description and the model generates the footage — and its own audio.",
};

export function UgcComposer({
  projects,
  voices,
  voiceError,
  elevenlabsConnected,
}: {
  projects: { id: number; name: string }[];
  voices: VoiceOption[];
  voiceError: string | null;
  elevenlabsConnected: boolean;
}) {
  const [modeLabel, setModeLabel] = useState(MODE_OPTIONS[0]!);
  const mode = MODE_LABELS[modeLabel]!;

  // One remembered model per mode, so flipping across to compare and back
  // does not throw away a considered choice.
  const [modelIds, setModelIds] = useState<Record<VideoModelInput, string>>({
    avatar: DEFAULT_AVATAR_MODEL_ID,
    prompt: DEFAULT_PROMPT_MODEL_ID,
  });

  const [brief, setBrief] = useState("");
  const [projectName, setProjectName] = useState(NO_PROJECT);
  const [voice, setVoice] = useState<{ voiceId: string; voiceName: string | null }>({
    voiceId: "",
    voiceName: null,
  });
  const [preferredAspect, setPreferredAspect] = useState("9:16");
  const [preferredResolution, setPreferredResolution] = useState("720p");
  const [preferredDuration, setPreferredDuration] = useState(8);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const { run, pending } = useAction();

  const models = useMemo(() => videoModelsFor(mode), [mode]);
  const model = models.find((m) => m.id === modelIds[mode]) ?? models[0]!;

  // Clamped to what this model actually accepts — see the module comment.
  const aspect = pick(model.aspectRatios, preferredAspect);
  const resolution = pick(model.resolutions, preferredResolution);
  const durationSecs = pick(model.durations, preferredDuration);

  const projectByName = new Map(projects.map((p) => [p.name, p.id]));
  const needsPhoto = model.input === "avatar";
  const ready =
    elevenlabsConnected &&
    brief.trim().length > 0 &&
    (!needsPhoto || (photo !== null && voice.voiceId.trim().length > 0));

  function choosePhoto(file: File | null | undefined) {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(file ? { file, url: URL.createObjectURL(file) } : null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const data = new FormData();
    data.set("brief", brief);
    data.set("videoModel", model.id);
    const projectId = projectByName.get(projectName);
    if (projectId) data.set("projectId", String(projectId));
    if (aspect) data.set("aspectRatio", aspect);
    if (resolution) data.set("resolution", resolution);
    if (durationSecs) data.set("durationSecs", String(durationSecs));

    if (model.input === "avatar") {
      if (!photo) return;
      data.set("voiceId", voice.voiceId);
      if (voice.voiceName) data.set("voiceName", voice.voiceName);
      data.set("presenterImage", photo.file);
    } else if (model.supportsGeneratedAudio) {
      data.set("generateAudio", String(generateAudio));
    }

    const result = await run(() => createUgcVideo(data), { quiet: true });
    if (result?.ok) {
      setBrief("");
      choosePhoto(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card title="Generate a video" subtitle={MODE_BLURB[mode]}>
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
          Connect ElevenLabs under Settings → Integrations before generating a video — each org uses its own
          account, its own voices, and its own billing.
        </p>
      )}

      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-6)" }}>
        {/* In the form body rather than the Card's header slot: in the header
            it competed with the title for one row, and on a phone that left
            the title wrapping down a column three words wide. */}
        <SegmentedControl options={MODE_OPTIONS} value={modeLabel} onChange={setModeLabel} size="sm" />

        <Field label="Brief" hint="One or two sentences. Falorb writes the script or the shot description from this.">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={
              mode === "avatar"
                ? "A skincare serum for combination skin — highlight the 2-week results and the no-fragrance formula."
                : "A serum bottle on wet stone, water beading on the glass, slow push-in as morning light moves across it."
            }
            rows={3}
            maxLength={2000}
            style={textareaStyle}
          />
        </Field>

        <Field label="Model" hint={`${models.length} ${mode === "avatar" ? "avatar" : "text-to-video"} models available on your ElevenLabs account.`}>
          <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {models.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                selected={m.id === model.id}
                onSelect={() => setModelIds((prev) => ({ ...prev, [mode]: m.id }))}
              />
            ))}
          </div>
        </Field>

        {needsPhoto && (
          <>
            <Field label="Voice" hint="Previews play from ElevenLabs and cost nothing — audition before you generate.">
              <VoicePicker
                voices={voices}
                loadError={voiceError}
                voiceId={voice.voiceId}
                onChange={setVoice}
              />
            </Field>

            <Field label="Presenter photo" hint="A clear, front-facing photo of the person delivering the script.">
              <PhotoDrop
                photo={photo}
                inputRef={fileRef}
                onChoose={choosePhoto}
              />
            </Field>
          </>
        )}

        <Field label="Output" hint={describeOutput(model)}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "center" }}>
            {model.aspectRatios.length > 0 && (
              <Control label="Aspect">
                <SegmentedControl
                  options={[...model.aspectRatios]}
                  value={aspect ?? ""}
                  onChange={setPreferredAspect}
                  size="sm"
                />
              </Control>
            )}
            {model.resolutions.length > 0 && (
              <Control label="Resolution">
                <Select
                  options={[...model.resolutions]}
                  value={resolution ?? ""}
                  onChange={setPreferredResolution}
                  size="sm"
                />
              </Control>
            )}
            {model.durations.length > 0 && (
              <Control label="Length">
                <Select
                  options={model.durations.map((d) => `${d}s`)}
                  value={durationSecs ? `${durationSecs}s` : ""}
                  onChange={(v) => setPreferredDuration(Number(v.replace("s", "")))}
                  size="sm"
                />
              </Control>
            )}
            {model.supportsGeneratedAudio && (
              <Control label="Audio">
                <Switch checked={generateAudio} onChange={setGenerateAudio} label="Model-generated" size="sm" />
              </Control>
            )}
            {projects.length > 0 && (
              <Control label="Property">
                <Select
                  value={projectName}
                  options={[NO_PROJECT, ...projects.map((p) => p.name)]}
                  onChange={setProjectName}
                  size="sm"
                />
              </Control>
            )}
          </div>
        </Field>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !ready}
            iconLeft={<Icon name="sparkles" size={14} />}
          >
            {pending ? "Starting" : "Generate video"}
          </Button>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            Runs on your ElevenLabs credits. Takes a few minutes.
          </span>
        </div>
      </form>
    </Card>
  );
}

function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: VideoModelSpec;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: "grid",
        gap: 4,
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: "var(--radius-3)",
        cursor: "pointer",
        background: selected ? "var(--w-8)" : "var(--surface-inset)",
        border: `1px solid ${selected ? "var(--accent-line)" : "var(--control-border)"}`,
        boxShadow: "var(--edge-top)",
        color: "inherit",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: "var(--size-body-sm)",
            fontWeight: "var(--wt-semibold)",
            color: "var(--text-primary)",
          }}
        >
          {model.label}
        </span>
        <Badge tone={selected ? "accent" : "neutral"}>{model.vendor}</Badge>
      </span>
      <span style={{ fontSize: "var(--size-micro)", color: "var(--text-secondary)", lineHeight: 1.4 }}>
        {model.blurb}
      </span>
      <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
        {model.resolutions.join(" · ")}
        {model.durations.length > 0 ? ` · up to ${model.durations[model.durations.length - 1]}s` : ""}
      </span>
    </button>
  );
}

function PhotoDrop({
  photo,
  inputRef,
  onChoose,
}: {
  photo: { file: File; url: string } | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChoose: (file: File | null) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file?.type.startsWith("image/")) onChoose(file);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: "var(--radius-control)",
        background: "var(--surface-inset)",
        border: `1px ${over ? "solid var(--accent-line)" : "dashed var(--control-border)"}`,
      }}
    >
      {/* The real input stays in the tree so the form and the file dialog
          both work; it is just never the thing you look at. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => onChoose(e.target.files?.[0] ?? null)}
        style={{ display: "none" }}
      />

      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local
        // object URL for a file the user just picked; there is nothing for
        // next/image to optimise and it cannot fetch a blob: URL anyway.
        <img
          src={photo.url}
          alt="Selected presenter"
          style={{ width: 56, height: 56, objectFit: "cover", borderRadius: "var(--radius-3)" }}
        />
      ) : (
        <span
          style={{
            display: "grid",
            placeItems: "center",
            width: 56,
            height: 56,
            borderRadius: "var(--radius-3)",
            background: "var(--w-8)",
            color: "var(--text-muted)",
          }}
        >
          <Icon name="user-round" size={20} />
        </span>
      )}

      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--size-body-sm)",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {photo ? photo.file.name : "Drop a photo here, or choose one"}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <Button type="button" size="sm" variant="secondary" onClick={() => inputRef.current?.click()}>
            {photo ? "Replace" : "Choose photo"}
          </Button>
          {photo && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChoose(null)}>
              Remove
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  resize: "vertical",
  padding: "8px 10px",
  borderRadius: "var(--radius-control)",
  background: "var(--surface-inset)",
  border: "1px solid var(--control-border)",
  boxShadow: "var(--edge-top)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--size-body-sm)",
  lineHeight: 1.5,
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span
        style={{
          fontSize: "var(--size-label)",
          color: "var(--text-secondary)",
          fontWeight: "var(--wt-medium)",
        }}
      >
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{hint}</span>}
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>{label}</span>
      {children}
    </div>
  );
}

/** What this model decides for itself, said plainly, so an absent control
 * reads as "not applicable here" rather than "Falorb forgot it". */
function describeOutput(model: VideoModelSpec): string {
  if (model.input === "avatar") {
    return "Framing follows your presenter photo and the clip runs as long as the voiceover, so this model takes no aspect ratio or length.";
  }
  return "Within what this model supports. Switching models re-fits anything it doesn't offer.";
}

function pick<T>(options: T[], preferred: T): T | null {
  if (options.length === 0) return null;
  return options.includes(preferred) ? preferred : options[0]!;
}
