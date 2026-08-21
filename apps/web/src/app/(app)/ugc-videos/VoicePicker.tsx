"use client";

import { useMemo, useRef, useState } from "react";
import { Badge, Icon, IconButton, Input } from "@falorb/ui";

/**
 * Picks a voice from the org's own ElevenLabs library, with an audible
 * preview.
 *
 * Replaces the raw "paste a voice ID" field this form used to have. That
 * field asked someone to leave Falorb, find the voice in ElevenLabs' UI,
 * copy a 20-character id, and come back — and gave no feedback at all if
 * they pasted the wrong one, since the mistake only surfaced minutes later
 * as a video in the wrong voice. Picking by name and hearing the voice
 * first removes both failures.
 *
 * Previews play ElevenLabs' own hosted `preview_url` directly. Nothing is
 * proxied through Falorb and no TTS credits are spent auditioning voices —
 * these samples are pre-rendered on ElevenLabs' side.
 *
 * The manual id field is still reachable (`Enter an ID instead`) and is the
 * only thing rendered when the library could not be loaded: a voice id is
 * what actually generates the video, so someone who knows theirs is never
 * blocked by a picker that failed to populate.
 */

export interface VoiceOption {
  voiceId: string;
  name: string;
  category: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
  description: string | null;
}

/** ElevenLabs attaches many labels; these are the ones that describe how a
 * voice *sounds*, which is what someone scanning a list is choosing on.
 * Anything else (language codes, internal use-case tags) is noise at this
 * size and is left to the preview to convey. */
const SHOWN_LABELS = ["gender", "age", "accent", "descriptive"];

export function VoicePicker({
  voices,
  loadError,
  voiceId,
  onChange,
}: {
  voices: VoiceOption[];
  loadError: string | null;
  voiceId: string;
  /** Both id and name — the name is denormalised onto the row so the review
   * page can still say which voice was used after it is renamed upstream. */
  onChange: (value: { voiceId: string; voiceName: string | null }) => void;
}) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return voices;
    return voices.filter(
      (v) =>
        v.name.toLowerCase().includes(needle) ||
        (v.category ?? "").toLowerCase().includes(needle) ||
        Object.values(v.labels).some((label) => label.toLowerCase().includes(needle)),
    );
  }, [voices, query]);

  function preview(voice: VoiceOption) {
    if (!voice.previewUrl) return;

    // One <audio> for the whole list, so starting a second preview stops the
    // first rather than layering two voices over each other.
    audioRef.current?.pause();
    if (playing === voice.voiceId) {
      setPlaying(null);
      return;
    }

    const audio = new Audio(voice.previewUrl);
    audio.addEventListener("ended", () => setPlaying(null));
    audio.addEventListener("error", () => setPlaying(null));
    audioRef.current = audio;
    void audio.play().catch(() => setPlaying(null));
    setPlaying(voice.voiceId);
  }

  const manualOnly = voices.length === 0;

  if (manual || manualOnly) {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <Input
          value={voiceId}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange({ voiceId: e.target.value, voiceName: null })
          }
          placeholder="Voice ID — from your ElevenLabs voice library"
          mono
        />
        <span style={{ fontSize: "var(--size-micro)", color: loadError ? "var(--signal-warn)" : "var(--text-muted)" }}>
          {loadError ??
            (manualOnly
              ? "No voices came back from your ElevenLabs account yet."
              : "Paste the id from ElevenLabs → Voices.")}
        </span>
        {!manualOnly && (
          <button type="button" onClick={() => setManual(false)} style={linkButtonStyle}>
            Back to your voice library
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Input
        value={query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        placeholder={`Search ${voices.length} voice${voices.length === 1 ? "" : "s"}`}
        size="sm"
        iconLeft={<Icon name="search" size={14} />}
      />

      <div
        style={{
          display: "grid",
          gap: 2,
          maxHeight: 232,
          overflowY: "auto",
          padding: 4,
          borderRadius: "var(--radius-control)",
          background: "var(--surface-inset)",
          border: "1px solid var(--control-border)",
        }}
      >
        {matches.length === 0 ? (
          <p style={{ padding: "10px 8px", fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            No voice matches “{query}”. Clear the search, or clone one in ElevenLabs.
          </p>
        ) : (
          matches.map((voice) => (
            <VoiceRow
              key={voice.voiceId}
              voice={voice}
              selected={voice.voiceId === voiceId}
              playing={playing === voice.voiceId}
              onSelect={() => onChange({ voiceId: voice.voiceId, voiceName: voice.name })}
              onPreview={() => preview(voice)}
            />
          ))
        )}
      </div>

      <button type="button" onClick={() => setManual(true)} style={linkButtonStyle}>
        Enter an ID instead
      </button>
    </div>
  );
}

function VoiceRow({
  voice,
  selected,
  playing,
  onSelect,
  onPreview,
}: {
  voice: VoiceOption;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const traits = SHOWN_LABELS.map((key) => voice.labels[key]).filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: "var(--radius-3)",
        background: selected ? "var(--w-8)" : "transparent",
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          flex: 1,
          minWidth: 0,
          display: "grid",
          gap: 2,
          textAlign: "left",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
          color: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {selected && <Icon name="check" size={13} color="var(--text-primary)" />}
          <span
            style={{
              fontSize: "var(--size-body-sm)",
              fontWeight: selected ? "var(--wt-semibold)" : "var(--wt-medium)",
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {voice.name}
          </span>
          {voice.category && <Badge tone="neutral">{voice.category.replace(/_/g, " ")}</Badge>}
        </span>
        {traits.length > 0 && (
          <span
            style={{
              fontSize: "var(--size-micro)",
              color: "var(--text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {traits.join(" · ")}
          </span>
        )}
      </button>

      {voice.previewUrl && (
        <IconButton
          label={playing ? `Stop previewing ${voice.name}` : `Preview ${voice.name}`}
          icon={<Icon name={playing ? "square" : "play"} size={13} />}
          size="sm"
          variant="ghost"
          onClick={onPreview}
        />
      )}
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = {
  justifySelf: "start",
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  color: "var(--text-muted)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--size-micro)",
  textDecoration: "underline",
};
