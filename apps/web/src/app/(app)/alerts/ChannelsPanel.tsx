"use client";

import { useState } from "react";
import { Badge, Button, Card, Dialog, Icon, IconButton, Input, SegmentedControl } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { createChannel, deleteChannel } from "@/server/actions/channels";
import { CHANNEL_LABELS as KIND_LABELS, type ChannelKind } from "@/lib/channel-kinds";
import { useAction } from "@/lib/use-action";

export interface ChannelView {
  id: string;
  name: string;
  kind: string;
  /** Where it delivers, with any secret omitted. */
  destination: string;
  active: boolean;
  ruleCount: number;
}

/**
 * Where alerts are delivered.
 *
 * Listed above the rules on the alerts page, because a rule without one of
 * these does nothing observable — the worker writes the message to its own
 * stdout and marks nothing as delivered.
 */
export function ChannelsPanel({
  channels,
  canEdit,
  emailConfigured,
}: {
  channels: ChannelView[];
  canEdit: boolean;
  emailConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ChannelKind>("slack");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [to, setTo] = useState("");

  async function submit() {
    const data = new FormData();
    data.set("name", name);
    data.set("kind", kind);
    data.set("url", url);
    data.set("secret", secret);
    data.set("to", to);

    const result = await run(() => createChannel(data), { success: "Channel added" });
    if (!result?.ok) return;

    setOpen(false);
    setName("");
    setUrl("");
    setSecret("");
    setTo("");
  }

  async function remove(id: string) {
    await run(() => deleteChannel(id));
  }

  return (
    <>
      <Card
        title="Delivery channels"
        subtitle="Where a firing alert is sent. A rule without one only reaches the worker's log."
        action={
          canEdit ? (
            <Button
              size="sm"
              iconLeft={<Icon name="plus" size={13} />}
              onClick={() => setOpen(true)}
            >
              Add channel
            </Button>
          ) : undefined
        }
      >
        {channels.length === 0 ? (
          <Empty
            icon="send"
            title="No delivery channels"
            body="Until one exists, an alert cannot notify anyone — the worker evaluates the rule and writes the result to its own stdout."
            action={
              canEdit ? (
                <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                  Add a channel
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="falorb-scroll-x">
          <div style={{ display: "grid", gap: 8 }}>
            {channels.map((channel) => (
              <div
                key={channel.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 90px minmax(0,1.2fr) 90px 34px",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: "var(--radius-2)",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <span
                  style={{
                    fontSize: "var(--size-body-sm)",
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {channel.name}
                </span>

                <Badge tone={channel.kind === "email" && !emailConfigured ? "warn" : "neutral"}>
                  {KIND_LABELS[channel.kind as ChannelKind] ?? channel.kind}
                </Badge>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={channel.destination}
                >
                  {channel.destination}
                </span>

                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                    textAlign: "right",
                  }}
                >
                  {channel.ruleCount} {channel.ruleCount === 1 ? "rule" : "rules"}
                </span>

                {canEdit ? (
                  <IconButton
                    size="sm"
                    label={`Remove ${channel.name}`}
                    icon={<Icon name="trash-2" size={13} />}
                    disabled={pending}
                    onClick={() => void remove(channel.id)}
                  />
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          </div>
        )}

      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add delivery channel"
        subtitle="Where alerts using this channel will be sent"
        width={480}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? "Adding" : "Add channel"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Engineering Slack"
          />

          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: "var(--size-label)",
                color: "var(--text-secondary)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              Type
            </span>
            <SegmentedControl
              size="sm"
              options={Object.values(KIND_LABELS)}
              value={KIND_LABELS[kind]}
              onChange={(label: string) => {
                const entry = Object.entries(KIND_LABELS).find(([, l]) => l === label);
                if (entry) setKind(entry[0] as ChannelKind);
              }}
            />
          </div>

          {kind === "email" ? (
            <>
              <Input
                label="Send to"
                type="email"
                value={to}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)}
                placeholder="oncall@example.com"
              />
              {!emailConfigured && (
                <span style={{ fontSize: "var(--size-micro)", color: "var(--signal-warn)" }}>
                  No mailer is configured on this instance, so email alerts will be recorded as
                  fired and never arrive. Use Slack or a webhook until one is set up.
                </span>
              )}
            </>
          ) : (
            <>
              <Input
                label={kind === "slack" ? "Slack incoming webhook URL" : "Webhook URL"}
                mono
                value={url}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                hint="Must be https — the worker posts alert contents to it."
              />
              {kind === "webhook" && (
                <Input
                  label="Signing secret"
                  mono
                  value={secret}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSecret(e.target.value)}
                  placeholder="optional"
                  hint="If set, deliveries carry an X-Falorb-Signature HMAC so the receiver can verify them."
                />
              )}
            </>
          )}

        </div>
      </Dialog>
    </>
  );
}
