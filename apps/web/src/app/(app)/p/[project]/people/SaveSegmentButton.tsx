"use client";

import { useState } from "react";
import { Button, Dialog, Input } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { saveSegment } from "@/server/actions/segments";
import { ConditionTreeBuilder, groupsToFilters, newEmptyGroups, type GroupDraft } from "@/components/ConditionTreeBuilder";

export function SaveSegmentButton({ projectId, fields }: { projectId: number; fields: string[] }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [groups, setGroups] = useState<GroupDraft[]>(() => newEmptyGroups(fields[0] ?? ""));

  const filters = groupsToFilters(groups);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Save as segment
      </Button>

      {open && (
        <Dialog
          title="Save as segment"
          subtitle="Match ALL groups below; within a group, match ANY condition. Scoped to this property."
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={pending || !name.trim() || !filters.length}
                onClick={async () => {
                  const result = await run(() => saveSegment(name, filters, projectId), { success: "Segment saved." });
                  if (result?.ok) {
                    setOpen(false);
                    setName("");
                    setGroups(newEmptyGroups(fields[0] ?? ""));
                  }
                }}
              >
                {pending ? "Saving…" : "Save segment"}
              </Button>
            </>
          }
        >
          <div style={{ display: "grid", gap: 10, minWidth: 480 }}>
            <Input
              label="Name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              placeholder="e.g. Power users on Chrome"
            />
            <ConditionTreeBuilder fields={fields} groups={groups} onChange={setGroups} />
          </div>
        </Dialog>
      )}
    </>
  );
}
