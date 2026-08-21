"use client";

import { useState } from "react";
import { Badge, Button, Card, Dialog, Icon, IconButton, Input, Select, Switch, Tag } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { createWebhook, deleteWebhook, toggleWebhook } from "@/server/actions/webhooks";
import { relative, shortDate } from "@/lib/format";

export interface WebhookView {
  id: string;
  projectSlug: string | null;
  projectName: string | null;
  url: string;
  triggers: string[];
  secretPreview: string;
  active: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  createdAt: string;
}

const ALL_PROPERTIES = "All properties";

/**
 * Outbound webhook endpoints. A hook subscribes to goal *names*, not raw
 * events (`apps/worker/src/jobs/webhooks.ts`), so the picker below shows
 * each property's actual goal names as clickable reference chips rather than
 * a free-floating text field with no ground truth.
 */
export function WebhooksPanel({
  webhooks,
  projects,
  goalsByProject,
  canManage,
  now,
}: {
  webhooks: WebhookView[];
  projects: { slug: string; name: string }[];
  goalsByProject: Record<string, string[]>;
  canManage: boolean;
  now: number;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [project, setProject] = useState(ALL_PROPERTIES);
  const [triggers, setTriggers] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  const projectOptions = [ALL_PROPERTIES, ...projects.map((p) => p.name)];
  const selectedSlug = projects.find((p) => p.name === project)?.slug;
  const availableGoals = selectedSlug ? (goalsByProject[selectedSlug] ?? []) : [];

  async function submit() {
    const data = new FormData();
    data.set("url", url);
    if (selectedSlug) data.set("project", selectedSlug);
    data.set("triggers", triggers);
    const result = await run(() => createWebhook(data));
    if (result?.ok) {
      setSecret(result.secret ?? null);
      setUrl("");
      setTriggers("");
    }
  }

  function addTrigger(name: string) {
    const current = triggers
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (current.includes(name)) return;
    setTriggers([...current, name].join(", "));
  }

  return (
    <>
      <Card
        title="Webhooks"
        subtitle="Fires on a goal conversion — a signup, a purchase, anything you've named as a goal"
        action={
          canManage ? (
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Icon name="plus" size={13} />}
              onClick={() => {
                setSecret(null);
                setOpen(true);
              }}
            >
              Add endpoint
            </Button>
          ) : undefined
        }
      >
        {webhooks.length === 0 ? (
          <Empty
            icon="webhook"
            title="No webhooks registered"
            body="Register a URL to receive conversion events as they happen — signed, at-least-once delivery."
          />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            {webhooks.map((hook) => (
              <div
                key={hook.id}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: "var(--space-3) 0",
                  borderBottom: "1px solid var(--grid-line)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--size-body-sm)",
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {hook.url}
                    </span>
                    <Badge tone={hook.active ? "up" : "neutral"}>{hook.active ? "active" : "disabled"}</Badge>
                    {hook.failureCount > 0 && <Badge tone="down">{hook.failureCount} failures</Badge>}
                  </div>
                  {canManage && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                      <Switch
                        checked={hook.active}
                        disabled={pending}
                        onChange={(next: boolean) => run(() => toggleWebhook(hook.id, next), { quiet: true })}
                      />
                      <IconButton
                        size="sm"
                        label="Delete webhook"
                        icon={<Icon name="trash-2" size={13} />}
                        disabled={pending}
                        onClick={() => run(() => deleteWebhook(hook.id))}
                      />
                    </div>
                  )}
                </div>
                <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  {hook.projectName ?? "All properties"} · triggers on{" "}
                  {hook.triggers.length ? hook.triggers.join(", ") : "every goal"} · secret ····{hook.secretPreview} ·{" "}
                  {hook.lastDeliveryAt
                    ? `last delivered ${relative(hook.lastDeliveryAt, now)}`
                    : "never delivered"}{" "}
                  · added {shortDate(hook.createdAt, now)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add webhook endpoint"
        subtitle="Signed with HMAC-SHA256 — the secret is shown once"
        width={520}
        footer={
          secret ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={submit} disabled={pending || !url.trim()}>
                {pending ? "Registering…" : "Register"}
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <CopyField label="Signing secret" value={secret} />
            <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: "var(--lh-normal)" }}>
              Stored only as this value — it won't be shown again. Verify each delivery's
              `X-Falorb-Signature` header against it.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Input
              label="URL"
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              placeholder="https://your-service.example.com/hooks/falorb"
            />
            <Select label="Property" value={project} options={projectOptions} onChange={setProject} />
            <Input
              label="Triggers"
              value={triggers}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTriggers(e.target.value)}
              placeholder="Goal names, comma separated — blank fires on every goal"
            />
            {availableGoals.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {availableGoals.map((name) => (
                  <Tag key={name} onClick={() => addTrigger(name)} style={{ cursor: "pointer" }}>
                    {name}
                  </Tag>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
