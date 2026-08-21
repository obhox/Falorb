"use client";

import { useState } from "react";
import { Button, Dialog, Input } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { listAiGatewayModels } from "@/server/actions/integrations";
import type { ActionResult } from "@/server/actions/project";

/**
 * "Bring your own model", the picking half of it: which model a connected
 * gateway is asked for.
 *
 * The candidate list is fetched from the gateway with the stored key rather
 * than shipped as a constant — OpenRouter carries hundreds of models and
 * changes them weekly, and Ramp Router's callable ids are key-specific
 * (its own docs say the names in its model table are not necessarily valid
 * `model` values, and to read `GET /models` for the real ones). A hardcoded
 * list would be wrong for somebody on the day it was written.
 *
 * The text field is still authoritative, and the list only fills it in:
 * a model that exists but hasn't reached the list yet must remain typeable,
 * and a gateway that won't answer the list request must not block changing
 * the model.
 */
export function AiModelPicker({
  provider,
  label,
  current,
  defaultModel,
  slug,
  onSave,
}: {
  provider: string;
  label: string;
  /** The stored model, or null when the connection is on the provider default. */
  current: string | null;
  /** What null means for this provider, or null when it means "nothing to call". */
  defaultModel: string | null;
  /** Set when picking for one property's own connection rather than the org's. */
  slug?: string;
  onSave: (model: string) => Promise<ActionResult>;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(current ?? "");
  const [models, setModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function openPicker() {
    setModel(current ?? "");
    setModels(null);
    setListError(null);
    setOpen(true);
    setLoading(true);
    const result = await listAiGatewayModels(provider, slug);
    setLoading(false);
    if (result.ok) setModels(result.models);
    else setListError(result.message);
  }

  const query = model.trim().toLowerCase();
  const matches = (models ?? [])
    .filter((m) => !query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query))
    .slice(0, 40);

  return (
    <>
      <Button size="sm" onClick={openPicker}>
        {current ? "Change model" : "Choose model"}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`${label} model`}
        subtitle={
          defaultModel
            ? `Leave blank to use ${defaultModel}, the provider's own per-request choice.`
            : `${label} has no automatic model — pick one, or AI features on this connection will fail.`
        }
        width={560}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={async () => {
                const result = await run(() => onSave(model));
                if (result?.ok) setOpen(false);
              }}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Model"
            mono
            value={model}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModel(e.target.value)}
            placeholder={defaultModel ?? "e.g. gemini-2.5-flash"}
            hint="Type an id, or pick one below. A comma-separated list is a fallback chain on OpenRouter."
          />

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              {loading
                ? `Loading models from ${label}…`
                : listError
                  ? `Could not load the model list: ${listError}`
                  : models
                    ? `${models.length} model${models.length === 1 ? "" : "s"} available to this key${
                        matches.length < models.length ? ` — showing ${matches.length}` : ""
                      }`
                    : null}
            </div>

            {matches.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gap: 2,
                  maxHeight: 240,
                  overflowY: "auto",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                  padding: 4,
                }}
              >
                {matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    style={{
                      textAlign: "left",
                      background: m.id === model.trim() ? "var(--surface-raised)" : "transparent",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      padding: "6px 8px",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                      fontSize: "var(--size-body-sm)",
                    }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)" }}>{m.id}</span>
                    {m.name !== m.id && (
                      <span style={{ color: "var(--text-muted)" }}> — {m.name}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
