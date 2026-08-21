"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Dialog, Icon, Input, Select, Tag } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { saveInsight } from "@/server/actions/insights";
import { CHARTS, DIMENSIONS, METRICS } from "@/lib/insight-options";

/**
 * The cross-project query controls.
 *
 * Metric, dimension, chart type and the property selection all live in the
 * URL, so an insight is a link. That is the whole point of this screen: it is
 * where someone builds a question worth sending to somebody else.
 *
 * The option maps are imported from `@/lib/insight-options` rather than
 * declared here, because the server page needs them too — see the note in that
 * file about values crossing a client-module boundary.
 */

export function InsightControls({
  metric,
  dimension,
  chart,
  projects,
  selected,
  canSave = false,
}: {
  metric: keyof typeof METRICS;
  dimension: keyof typeof DIMENSIONS;
  chart: keyof typeof CHARTS;
  projects: { slug: string; name: string }[];
  selected: string[];
  canSave?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const { run, pending: saving } = useAction();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  function push(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function toggleProject(slug: string) {
    // An empty selection means every property, so deselecting the last one
    // widens rather than showing nothing.
    const set = new Set(selected.length ? selected : projects.map((p) => p.slug));
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);

    push((next) => {
      if (set.size === 0 || set.size === projects.length) next.delete("projects");
      else next.set("projects", [...set].join(","));
    });
  }

  const active = new Set(selected.length ? selected : projects.map((p) => p.slug));

  async function save() {
    const result = await run(() =>
      saveInsight(name, { metric, dimension, projectSlugs: [...active] }, chart),
    );
    if (result?.ok) {
      setSaveOpen(false);
      setName("");
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <Field label="Metric">
          <Select
            size="sm"
            value={METRICS[metric]}
            options={Object.values(METRICS)}
            onChange={(label: string) => {
              const entry = Object.entries(METRICS).find(([, l]) => l === label);
              if (entry) push((next) => next.set("metric", entry[0]));
            }}
          />
        </Field>

        <Field label="Broken down by">
          <Select
            size="sm"
            value={DIMENSIONS[dimension]}
            options={Object.values(DIMENSIONS)}
            onChange={(label: string) => {
              const entry = Object.entries(DIMENSIONS).find(([, l]) => l === label);
              if (entry) push((next) => next.set("dim", entry[0]));
            }}
          />
        </Field>

        <Field label="Shown as">
          <Select
            size="sm"
            value={CHARTS[chart]}
            options={Object.values(CHARTS)}
            onChange={(label: string) => {
              const entry = Object.entries(CHARTS).find(([, l]) => l === label);
              if (entry) push((next) => next.set("chart", entry[0]));
            }}
          />
        </Field>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: "var(--size-micro)",
            textTransform: "uppercase",
            letterSpacing: "var(--ls-label)",
            color: "var(--text-muted)",
            fontWeight: "var(--wt-medium)",
            marginRight: 4,
          }}
        >
          Properties
        </span>
        {projects.map((project) => (
          <Tag
            key={project.slug}
            active={active.has(project.slug)}
            onClick={() => toggleProject(project.slug)}
          >
            {project.name}
          </Tag>
        ))}

        {canSave && (
          <Button
            size="sm"
            iconLeft={<Icon name="save" size={13} />}
            style={{ marginLeft: "auto" }}
            onClick={() => setSaveOpen(true)}
          >
            Save
          </Button>
        )}
      </div>

      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this insight"
        subtitle="Shows up as a link above, for the whole workspace"
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
          placeholder="Signups by channel"
        />
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span
        style={{
          fontSize: "var(--size-micro)",
          textTransform: "uppercase",
          letterSpacing: "var(--ls-label)",
          color: "var(--text-muted)",
          fontWeight: "var(--wt-medium)",
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}
