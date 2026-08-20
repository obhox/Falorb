"use client";

import { useState } from "react";
import { Badge, Button, Card, Icon, Input } from "@falorb/ui";
import { connectClay, disconnectClay } from "@/server/actions/integrations";
import { useAction } from "@/lib/use-action";
import { relative } from "@/lib/format";

export interface ClayConnectionView {
  status: string;
  credentialPreview: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/**
 * Connect the organization's own Clay account for prospect contact
 * enrichment (`apps/worker/src/jobs/clay-enrichment.ts`). Gated by the
 * caller — see `connectClay`'s docblock for why this is stricter than every
 * other prospecting control.
 */
export function ClayConnectionPanel({
  initial,
  canEdit,
}: {
  initial: ClayConnectionView | null;
  canEdit: boolean;
}) {
  const { run, pending } = useAction();
  const [connected, setConnected] = useState(initial?.status === "connected");
  const [apiKey, setApiKey] = useState("");

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    const data = new FormData();
    data.set("apiKey", apiKey);
    const result = await run(() => connectClay(data));
    if (result?.ok) {
      setConnected(true);
      setApiKey("");
    }
  }

  async function disconnect() {
    const result = await run(() => disconnectClay());
    if (result?.ok) setConnected(false);
  }

  return (
    <Card
      title="Clay"
      subtitle="Contact enrichment for discovered prospects — name, email, title, LinkedIn"
      action={connected ? <Badge tone="accent" dot>connected</Badge> : undefined}
    >
      <div style={{ display: "grid", gap: "var(--space-6)" }}>
        {connected ? (
          <>
            <div style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>
                API key ending in {initial?.credentialPreview ?? "····"}
              </span>
              {initial?.lastSyncAt && (
                <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  Last synced {relative(initial.lastSyncAt)}
                </span>
              )}
              {initial?.lastSyncError && (
                <span style={{ fontSize: "var(--size-micro)", color: "var(--signal-down)" }}>
                  {initial.lastSyncError}
                </span>
              )}
            </div>
            {canEdit && (
              <div>
                <Button
                  size="sm"
                  variant="danger"
                  iconLeft={<Icon name="unplug" size={13} />}
                  disabled={pending}
                  onClick={disconnect}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </>
        ) : canEdit ? (
          <form onSubmit={connect} style={{ display: "grid", gap: "var(--space-4)" }}>
            <Input
              type="password"
              label="Clay API key"
              value={apiKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
              placeholder="Paste your Clay API key"
              hint="Stored encrypted. Never shown again after connecting — only the last 4 characters."
            />
            <div>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={pending || apiKey.trim().length < 8}
                iconLeft={<Icon name="plug" size={13} />}
              >
                {pending ? "Connecting…" : "Connect Clay"}
              </Button>
            </div>
          </form>
        ) : (
          <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>
            Not connected. An admin can connect a Clay account to enrich discovered prospects.
          </span>
        )}
      </div>
    </Card>
  );
}
