"use client";

import Link from "next/link";
import { Badge, DataTable } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { relative } from "@/lib/format";

export interface RunTrackItem {
  id: string;
  contactId: string | null;
  contactName: string | null;
  targetLinkiId: string;
  track: string | null;
  state: string | null;
  currentStep: number | null;
  lastStepAt: string | null;
  nextStepAt: string | null;
  errorMessage: string | null;
}

const STATE_TONE: Record<string, "up" | "down" | "warn" | "neutral"> = {
  completed: "up",
  sent: "up",
  replied: "up",
  failed: "down",
  error: "down",
  bounced: "down",
  pending: "warn",
  in_progress: "warn",
};

function toneFor(value: string | null): "up" | "down" | "warn" | "neutral" {
  if (!value) return "neutral";
  return STATE_TONE[value.toLowerCase()] ?? "neutral";
}

export function RunTracksTable({ tracks, now }: { tracks: RunTrackItem[]; now: number }) {
  return (
    <DataTable
      dense
      columns={[
        {
          key: "contact",
          header: "Contact",
          width: "minmax(150px, 1.2fr)",
          render: (r: RunTrackItem) =>
            r.contactId ? (
              <Link href={`/crm/contacts/${r.contactId}`} data-plain style={{ color: "var(--text-primary)" }}>
                {r.contactName ?? r.targetLinkiId}
              </Link>
            ) : (
              r.contactName ?? r.targetLinkiId
            ),
        },
        { key: "track", header: "Channel", width: "110px", render: (r: RunTrackItem) => r.track ?? "—" },
        {
          key: "state",
          header: "State",
          width: "120px",
          render: (r: RunTrackItem) => <Badge tone={toneFor(r.state)}>{r.state ?? "—"}</Badge>,
        },
        { key: "step", header: "Step", width: "70px", align: "right", mono: true, render: (r: RunTrackItem) => r.currentStep ?? "—" },
        {
          key: "lastStepAt",
          header: "Last step",
          width: "100px",
          align: "right",
          mono: true,
          render: (r: RunTrackItem) => (r.lastStepAt ? relative(r.lastStepAt, now) : "—"),
        },
        {
          key: "nextStepAt",
          header: "Next step",
          width: "100px",
          align: "right",
          mono: true,
          render: (r: RunTrackItem) => (r.nextStepAt ? relative(r.nextStepAt, now) : "—"),
        },
        {
          key: "error",
          header: "Error",
          width: "minmax(120px, 1fr)",
          render: (r: RunTrackItem) => r.errorMessage ?? "—",
        },
      ]}
      rows={tracks}
      emptyState={<Empty dense icon="workflow" title="No tracks yet" body="Nothing has synced for this run yet." />}
    />
  );
}
