"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, DataTable, Dialog, IconButton, Icon, Input, Select } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { relative, num } from "@/lib/format";
import { useAction } from "@/lib/use-action";
import { deleteSegment, renameSegment, saveSegment } from "@/server/actions/segments";
import {
  ConditionTreeBuilder,
  groupsToFilters,
  newEmptyGroups,
  type GroupDraft,
} from "@/components/ConditionTreeBuilder";
import type { Filter } from "@falorb/queries";

export interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  projectId: number | null;
  projectName: string | null;
  projectSlug: string | null;
  filters: Filter[];
  cachedCount: number | null;
  cachedAt: string | null;
  createdAt: string;
}

export interface ProjectOption {
  id: number;
  name: string;
  slug: string;
}

const ALL_PROPERTIES = "All properties";

export function SegmentsPanel({
  segments,
  projects,
  fields,
  canManage,
  now,
}: {
  segments: SegmentRow[];
  projects: ProjectOption[];
  fields: string[];
  canManage: boolean;
  now: number;
}) {
  const { run, pending } = useAction();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<SegmentRow | null>(null);

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <Card
        title="Segments"
        subtitle="Reusable person filters — build once, use anywhere a segment applies"
        action={
          canManage && (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              New segment
            </Button>
          )
        }
      >
        <DataTable
          dense
          columns={[
            { key: "name", header: "Name", width: "minmax(140px, 1.2fr)", render: (r: SegmentRow) => r.name },
            {
              key: "scope",
              header: "Scope",
              width: "minmax(120px, 1fr)",
              render: (r: SegmentRow) =>
                r.projectSlug ? (
                  <Link href={`/p/${r.projectSlug}/people`} data-plain style={{ color: "var(--text-primary)" }}>
                    {r.projectName}
                  </Link>
                ) : (
                  <Badge tone="neutral">all properties</Badge>
                ),
            },
            {
              key: "count",
              header: "People",
              width: "90px",
              align: "right",
              mono: true,
              render: (r: SegmentRow) => (r.cachedCount === null ? "—" : num(r.cachedCount)),
            },
            {
              key: "cachedAt",
              header: "Refreshed",
              width: "100px",
              align: "right",
              mono: true,
              render: (r: SegmentRow) => (r.cachedAt ? relative(r.cachedAt, now) : "pending"),
            },
            {
              key: "conditions",
              header: "Conditions",
              width: "70px",
              align: "right",
              mono: true,
              render: (r: SegmentRow) => r.filters.length,
            },
            ...(canManage
              ? [
                  {
                    key: "actions",
                    header: "",
                    width: "90px",
                    align: "right" as const,
                    render: (r: SegmentRow) => (
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <IconButton
                          size="sm"
                          label="Rename"
                          icon={<Icon name="pencil" size={13} />}
                          onClick={() => setRenaming(r)}
                        />
                        <IconButton
                          size="sm"
                          label="Delete"
                          icon={<Icon name="trash-2" size={13} />}
                          disabled={pending}
                          onClick={() => void run(() => deleteSegment(r.id), { success: "Segment deleted." })}
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
          rows={segments}
          emptyState={
            <Empty
              dense
              icon="filter"
              title="No segments yet"
              body="Build one from conditions on events, sources, devices or custom properties."
            />
          }
        />
      </Card>

      {creating && (
        <NewSegmentDialog
          projects={projects}
          fields={fields}
          pending={pending}
          onClose={() => setCreating(false)}
          onSave={async (name, filters, projectId) => {
            const result = await run(() => saveSegment(name, filters, projectId), { success: "Segment saved." });
            if (result?.ok) setCreating(false);
          }}
        />
      )}

      {renaming && (
        <RenameSegmentDialog
          segment={renaming}
          pending={pending}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            const result = await run(() => renameSegment(renaming.id, name), { success: "Segment renamed." });
            if (result?.ok) setRenaming(null);
          }}
        />
      )}
    </div>
  );
}

function NewSegmentDialog({
  projects,
  fields,
  pending,
  onClose,
  onSave,
}: {
  projects: ProjectOption[];
  fields: string[];
  pending: boolean;
  onClose: () => void;
  onSave: (name: string, filters: Filter[], projectId: number | null) => void;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState(ALL_PROPERTIES);
  const [groups, setGroups] = useState<GroupDraft[]>(() => newEmptyGroups(fields[0] ?? ""));

  const filters = groupsToFilters(groups);
  const projectId = scope === ALL_PROPERTIES ? null : (projects.find((p) => p.name === scope)?.id ?? null);

  return (
    <Dialog
      title="New segment"
      subtitle="Match ALL groups below; within a group, match ANY condition"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !name.trim() || !filters.length}
            onClick={() => onSave(name, filters, projectId)}
          >
            {pending ? "Saving…" : "Save segment"}
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10, minWidth: 480 }}>
        <Input label="Name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="e.g. Power users on Chrome" />
        <Select label="Scope" value={scope} options={[ALL_PROPERTIES, ...projects.map((p) => p.name)]} onChange={setScope} />
        <ConditionTreeBuilder fields={fields} groups={groups} onChange={setGroups} />
      </div>
    </Dialog>
  );
}

function RenameSegmentDialog({
  segment,
  pending,
  onClose,
  onSave,
}: {
  segment: SegmentRow;
  pending: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(segment.name);
  return (
    <Dialog
      title="Rename segment"
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={pending || !name.trim()} onClick={() => onSave(name)}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Input label="Name" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
    </Dialog>
  );
}
