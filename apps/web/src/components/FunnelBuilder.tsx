"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Dialog, Icon, IconButton, Input, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { saveFunnel } from "@/server/actions/funnels";
import {
  MODE_LABELS,
  serializeSteps,
  type FunnelMode,
  type FunnelSpec,
} from "@/lib/funnel-spec";

/**
 * The funnel definition editor.
 *
 * Edits are local until "Run" — a funnel is an expensive query and re-running
 * it on every keystroke would hammer ClickHouse to show intermediate states
 * nobody asked for. Running writes the definition to the URL, which is what
 * makes the result shareable.
 */

interface DraftStep {
  event: string;
  path: string;
}

export function FunnelBuilder({
  slug,
  spec,
  canSave,
}: {
  slug: string;
  spec: FunnelSpec;
  canSave: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const { run: runSave, pending: saving } = useAction();

  const [steps, setSteps] = useState<DraftStep[]>(() =>
    spec.steps.map((step) => ({
      event: step.event ?? "$pageview",
      path: pathCondition(step.filters),
    })),
  );
  const [mode, setMode] = useState<FunnelMode>(spec.mode);
  const [windowHours, setWindowHours] = useState(String(spec.windowHours));
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  function update(index: number, patch: Partial<DraftStep>) {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    );
  }

  function usableSteps() {
    return steps
      .filter((step) => step.event.trim())
      .map((step) => ({
        label: step.event,
        event: step.event.trim(),
        ...(step.path.trim()
          ? { filters: [{ field: "path", op: "eq" as const, value: step.path.trim() }] }
          : {}),
      }));
  }

  function run() {
    const usable = usableSteps();
    if (usable.length < 2) return;

    const next = new URLSearchParams(params.toString());
    next.set("steps", serializeSteps(usable));
    next.set("mode", mode);
    next.set("window", windowHours);

    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  async function save() {
    const result = await runSave(() =>
      saveFunnel(slug, name, usableSteps(), Number(windowHours) || 168),
    );
    if (result?.ok) {
      setSaveOpen(false);
      setName("");
    }
  }

  const tooFew = steps.filter((step) => step.event.trim()).length < 2;

  return (
    <Card
      title="Steps"
      subtitle="An event name, and optionally the page it must have happened on"
    >
      <div style={{ display: "grid", gap: "var(--space-6)" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {steps.map((step, index) => (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "22px minmax(0,1fr) minmax(0,1fr) 34px",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--size-micro)",
                  color: "var(--text-muted)",
                }}
              >
                {index + 1}
              </span>
              <Input
                size="sm"
                mono
                value={step.event}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  update(index, { event: e.target.value })
                }
                placeholder="$pageview"
              />
              <Input
                size="sm"
                mono
                value={step.path}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  update(index, { path: e.target.value })
                }
                placeholder="/pricing (optional)"
              />
              <IconButton
                label={`Remove step ${index + 1}`}
                size="sm"
                icon={<Icon name="x" size={13} />}
                disabled={steps.length <= 2}
                onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
              />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <Button
            size="sm"
            iconLeft={<Icon name="plus" size={13} />}
            disabled={steps.length >= 8}
            onClick={() => setSteps((current) => [...current, { event: "", path: "" }])}
          >
            Add step
          </Button>

          <Select
            size="sm"
            value={MODE_LABELS[mode]}
            options={Object.values(MODE_LABELS)}
            onChange={(label: string) => {
              const entry = Object.entries(MODE_LABELS).find(([, l]) => l === label);
              if (entry) setMode(entry[0] as FunnelMode);
            }}
          />

          <Input
            size="sm"
            mono
            value={windowHours}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWindowHours(e.target.value)}
            suffix="h"
            style={{ width: 110 }}
          />

          {canSave && (
            <Button
              size="sm"
              disabled={tooFew}
              iconLeft={<Icon name="save" size={13} />}
              style={{ marginLeft: "auto" }}
              onClick={() => setSaveOpen(true)}
            >
              Save
            </Button>
          )}

          <Button
            size="sm"
            variant="primary"
            onClick={run}
            disabled={pending || tooFew}
            iconLeft={<Icon name="play" size={13} />}
            style={canSave ? undefined : { marginLeft: "auto" }}
          >
            {pending ? "Running" : "Run funnel"}
          </Button>
        </div>

        {tooFew && (
          <span style={{ fontSize: "var(--size-micro)", color: "var(--signal-warn)" }}>
            A funnel needs at least two steps — one to enter and one to convert.
          </span>
        )}
      </div>

      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this funnel"
        subtitle="Named funnels show up as links above, for this property"
        width={440}
        footer={
          <>
            <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <Input
          label="Name"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="Trial to subscription"
        />
      </Dialog>
    </Card>
  );
}

function pathCondition(filters: unknown): string {
  if (!Array.isArray(filters)) return "";
  const first = filters[0];
  if (!first || typeof first !== "object") return "";
  const condition = first as { field?: string; value?: unknown };
  return condition.field === "path" && typeof condition.value === "string" ? condition.value : "";
}
