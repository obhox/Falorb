"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Icon,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Switch,
} from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { createAlert, deleteAlert, setAlertActive } from "@/server/actions/alerts";
import { relative } from "@/lib/format";

export interface AlertView {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  description: string;
  scope: string;
  /** Null when the rule delivers nowhere. */
  channelName: string | null;
  active: boolean;
  cooldownMinutes: number;
  lastFiredAt: string | null;
  lastEvaluatedAt: string | null;
  recent: { id: string; status: string; message: string | null; createdAt: string }[];
}

const KIND_LABELS = {
  threshold: "Threshold",
  anomaly: "Anomaly",
  no_data: "No data",
  error_spike: "Error spike",
} as const;

const METRIC_LABELS = ["visitors", "sessions", "pageviews", "events", "revenue"] as const;

const OPERATOR_LABELS = {
  lt: "below",
  lte: "at or below",
  gt: "above",
  gte: "at or above",
} as const;

const DIRECTION_LABELS = {
  drop: "falls by",
  rise: "rises by",
  either: "changes by",
} as const;

export function AlertsPanel({
  alerts,
  projects,
  channels,
  now,
}: {
  alerts: AlertView[];
  projects: { slug: string; name: string }[];
  channels: { id: string; name: string }[];
  now: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<keyof typeof KIND_LABELS>("threshold");
  const [metric, setMetric] = useState<string>("visitors");
  const [operator, setOperator] = useState<keyof typeof OPERATOR_LABELS>("lt");
  const [direction, setDirection] = useState<keyof typeof DIRECTION_LABELS>("drop");
  const [value, setValue] = useState("100");
  const [windowMinutes, setWindowMinutes] = useState("60");
  const [cooldown, setCooldown] = useState("60");
  const [scope, setScope] = useState("");
  const [channel, setChannel] = useState(channels[0]?.id ?? "");

  async function submit() {
    setError(null);
    const data = new FormData();
    data.set("name", name);
    data.set("kind", kind);
    data.set("metric", metric);
    data.set("operator", operator);
    data.set("direction", direction);
    data.set("value", value);
    data.set("window_minutes", windowMinutes);
    data.set("cooldown_minutes", cooldown);
    data.set("project", scope);
    data.set("channel", channel);

    const result = await createAlert(data);
    if (!result.ok) {
      setError(result.message ?? "That alert could not be created.");
      return;
    }
    setOpen(false);
    setName("");
    startTransition(() => router.refresh());
  }

  const scopeLabels = ["All properties", ...projects.map((p) => p.name)];

  return (
    <>
      <Card
        title="Alert rules"
        subtitle="Evaluated by the alerts worker every five minutes"
        action={
          <Button
            size="sm"
            variant="primary"
            iconLeft={<Icon name="plus" size={13} />}
            onClick={() => setOpen(true)}
          >
            Add alert
          </Button>
        }
      >
        {alerts.length === 0 ? (
          <Empty
            icon="bell"
            title="No alerts configured"
            body="An alert watches a metric and notifies a channel when it breaches. Without one, a broken tracker looks exactly like a quiet week."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                Add the first alert
              </Button>
            }
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {alerts.map((alert) => (
              <div
                key={alert.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 130px 120px 44px 34px",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: "var(--radius-2)",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-subtle)",
                  opacity: alert.active ? 1 : 0.55,
                }}
              >
                <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: "var(--size-body-sm)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {alert.name}
                    <Badge tone="neutral">{alert.kindLabel}</Badge>
                  </span>
                  <span
                    style={{
                      fontSize: "var(--size-micro)",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {alert.scope} · {alert.description} ·{" "}
                    {alert.channelName ? (
                      <>to {alert.channelName}</>
                    ) : (
                      <span style={{ color: "var(--signal-warn)" }}>delivers nowhere</span>
                    )}
                  </span>
                </span>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: alert.lastFiredAt ? "var(--signal-warn)" : "var(--text-muted)",
                  }}
                >
                  {alert.lastFiredAt ? `fired ${relative(alert.lastFiredAt, now)}` : "never fired"}
                </span>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                  }}
                >
                  {alert.lastEvaluatedAt
                    ? `checked ${relative(alert.lastEvaluatedAt, now)}`
                    : "not yet checked"}
                </span>

                <Switch
                  size="sm"
                  checked={alert.active}
                  onChange={(checked: boolean) => {
                    void setAlertActive(alert.id, checked).then(() =>
                      startTransition(() => router.refresh()),
                    );
                  }}
                />

                <IconButton
                  size="sm"
                  label={`Remove ${alert.name}`}
                  icon={<Icon name="trash-2" size={13} />}
                  disabled={pending}
                  onClick={() => {
                    void deleteAlert(alert.id).then(() =>
                      startTransition(() => router.refresh()),
                    );
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add alert"
        subtitle="What to watch, and when it counts as a problem"
        width={520}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={pending || channels.length === 0}
            >
              Create alert
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Traffic dropped on the docs site"
          />

          <div style={{ display: "grid", gap: 6 }}>
            <Label>Kind</Label>
            <SegmentedControl
              size="sm"
              options={Object.values(KIND_LABELS)}
              value={KIND_LABELS[kind]}
              onChange={(label: string) => {
                const entry = Object.entries(KIND_LABELS).find(([, l]) => l === label);
                if (entry) setKind(entry[0] as keyof typeof KIND_LABELS);
              }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <Label>Property</Label>
            <Select
              size="sm"
              value={scope ? (projects.find((p) => p.slug === scope)?.name ?? "All properties") : "All properties"}
              options={scopeLabels}
              onChange={(label: string) => {
                const project = projects.find((p) => p.name === label);
                setScope(project?.slug ?? "");
              }}
            />
          </div>

          {(kind === "threshold" || kind === "anomaly") && (
            <div style={{ display: "grid", gap: 6 }}>
              <Label>Metric</Label>
              <Select
                size="sm"
                value={metric}
                options={[...METRIC_LABELS]}
                onChange={setMetric}
              />
            </div>
          )}

          {kind === "threshold" && (
            <div style={{ display: "grid", gap: 6 }}>
              <Label>Fires when the metric is</Label>
              <Select
                size="sm"
                value={OPERATOR_LABELS[operator]}
                options={Object.values(OPERATOR_LABELS)}
                onChange={(label: string) => {
                  const entry = Object.entries(OPERATOR_LABELS).find(([, l]) => l === label);
                  if (entry) setOperator(entry[0] as keyof typeof OPERATOR_LABELS);
                }}
              />
            </div>
          )}

          {kind === "anomaly" && (
            <div style={{ display: "grid", gap: 6 }}>
              <Label>Fires when the metric</Label>
              <Select
                size="sm"
                value={DIRECTION_LABELS[direction]}
                options={Object.values(DIRECTION_LABELS)}
                onChange={(label: string) => {
                  const entry = Object.entries(DIRECTION_LABELS).find(([, l]) => l === label);
                  if (entry) setDirection(entry[0] as keyof typeof DIRECTION_LABELS);
                }}
              />
            </div>
          )}

          {kind !== "no_data" && (
            <Input
              label={kind === "anomaly" ? "Change" : kind === "error_spike" ? "Errors" : "Value"}
              mono
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
              suffix={kind === "anomaly" ? "%" : undefined}
            />
          )}

          <div style={{ display: "grid", gap: 6 }}>
            <Label>Deliver to</Label>
            {channels.length === 0 ? (
              <span style={{ fontSize: "var(--size-micro)", color: "var(--signal-warn)" }}>
                No delivery channels exist yet. Add one above, or this rule will fire and notify
                nobody.
              </span>
            ) : (
              <Select
                size="sm"
                value={channels.find((c) => c.id === channel)?.name ?? channels[0]!.name}
                options={channels.map((c) => c.name)}
                onChange={(label: string) => {
                  const next = channels.find((c) => c.name === label);
                  if (next) setChannel(next.id);
                }}
              />
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input
              label="Window"
              mono
              value={windowMinutes}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWindowMinutes(e.target.value)}
              suffix="min"
            />
            <Input
              label="Cooldown"
              mono
              value={cooldown}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCooldown(e.target.value)}
              suffix="min"
              hint="A sustained breach notifies once per cooldown."
            />
          </div>

          {error && (
            <span style={{ fontSize: "var(--size-label)", color: "var(--signal-down)" }}>
              {error}
            </span>
          )}
        </div>
      </Dialog>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "var(--size-label)",
        color: "var(--text-secondary)",
        fontWeight: "var(--wt-medium)",
      }}
    >
      {children}
    </span>
  );
}
