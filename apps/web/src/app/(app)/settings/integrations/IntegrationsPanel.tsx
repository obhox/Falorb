"use client";

import { useState } from "react";
import { Badge, Button, Card, Dialog, Icon, Input } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { relative, shortDate } from "@/lib/format";
import {
  connectIntegration,
  revokeIntegrationConnection,
  testIntegrationConnection,
  type Provider,
} from "@/server/actions/integrations";
import type { ConnectionView } from "@/server/integrations";

const LABELS: Record<Provider, string> = { linki: "Linki", bund_ai: "Bund AI" };
const BLURBS: Record<Provider, string> = {
  linki: "Sales outreach & CRM. Generate a scoped key in Linki at Platform → Workspace & API.",
  bund_ai: "AI customer support. Generate a key in Bund AI at Settings → API access.",
};

export function IntegrationsPanel({
  connections,
  canManage,
  now,
}: {
  connections: ConnectionView[];
  canManage: boolean;
  now: number;
}) {
  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      {(["linki", "bund_ai"] as Provider[]).map((provider) => (
        <ProviderCard
          key={provider}
          provider={provider}
          connection={byProvider.get(provider) ?? null}
          canManage={canManage}
          now={now}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  connection,
  canManage,
  now,
}: {
  provider: Provider;
  connection: ConnectionView | null;
  canManage: boolean;
  now: number;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  const connected = connection?.status === "active";
  const errored = connection?.status === "error";

  async function submit() {
    const data = new FormData();
    data.set("baseUrl", baseUrl);
    data.set("apiKey", apiKey);
    const result = await run(() => connectIntegration(provider, data));
    if (result?.ok) {
      setOpen(false);
      setBaseUrl("");
      setApiKey("");
    }
  }

  return (
    <>
      <Card
        title={LABELS[provider]}
        subtitle={BLURBS[provider]}
        action={
          connection ? (
            connection.status === "revoked" ? (
              canManage && (
                <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                  Reconnect
                </Button>
              )
            ) : (
              canManage && (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => void run(() => testIntegrationConnection(provider), { quiet: false })}
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={pending}
                    onClick={() => void run(() => revokeIntegrationConnection(provider))}
                  >
                    Revoke
                  </Button>
                </div>
              )
            )
          ) : (
            canManage && (
              <Button size="sm" variant="primary" iconLeft={<Icon name="plug" size={13} />} onClick={() => setOpen(true)}>
                Connect
              </Button>
            )
          )
        }
      >
        {!connection ? (
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
            Not connected.{" "}
            {!canManage && "An owner or admin can connect this."}
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Badge tone={connected ? "up" : connection.status === "revoked" ? "neutral" : "down"}>
                {connection.status}
              </Badge>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--size-micro)",
                  color: "var(--text-secondary)",
                }}
              >
                {connection.baseUrl}
              </span>
            </div>
            <div style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: 1.7 }}>
              <div>
                last synced:{" "}
                {connection.lastSyncedAt ? relative(connection.lastSyncedAt, now) : "never — the mirror job runs every 15 minutes"}
              </div>
              <div>
                last verified:{" "}
                {connection.lastVerifiedAt ? shortDate(connection.lastVerifiedAt, now) : "never"}
              </div>
              {errored && connection.lastError && (
                <div style={{ color: "var(--signal-down)" }}>error: {connection.lastError}</div>
              )}
            </div>
          </div>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Connect ${LABELS[provider]}`}
        subtitle={BLURBS[provider]}
        width={520}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={pending || !baseUrl.trim() || !apiKey.trim()}
            >
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Base URL"
            value={baseUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
            placeholder="https://your-instance.example.com"
            hint={`Where your ${LABELS[provider]} deployment is reachable from this server.`}
          />
          <Input
            label="API key"
            mono
            value={apiKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
            placeholder={provider === "linki" ? "lnk_…" : "bund_sk_…"}
            hint="Stored encrypted (AES-256-GCM). Never shown again after this."
          />
        </div>
      </Dialog>
    </>
  );
}
