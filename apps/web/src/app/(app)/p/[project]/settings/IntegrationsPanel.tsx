"use client";

import { useState } from "react";
import { Badge, Button, Card, Dialog, Icon, Input } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { shortDate } from "@/lib/format";
import {
  connectProjectIntegration,
  revokeProjectIntegrationConnection,
  setProjectIntegrationModel,
  testProjectIntegrationConnection,
  type Provider,
} from "@/server/actions/integrations";
import type { ProjectConnectionView } from "@/server/integrations";
import { AI_DEFAULT_MODELS, isAiProvider } from "@/lib/ai-providers";
import { AiModelPicker } from "@/app/(app)/settings/integrations/AiModelPicker";

const LABELS: Record<Provider, string> = {
  openrouter: "OpenRouter",
  router: "Ramp Router",
  gemini: "Google Gemini",
  linki: "Linki",
  bund_ai: "Bund AI",
  buffer: "Buffer",
  clay: "Clay",
  exa: "Exa",
  firecrawl: "Firecrawl",
  elevenlabs: "ElevenLabs",
  openseo: "OpenSEO",
};

const HAS_BASE_URL: Record<Provider, boolean> = {
  openrouter: false,
  router: false,
  gemini: false,
  linki: true,
  bund_ai: true,
  buffer: false,
  clay: false,
  exa: false,
  firecrawl: false,
  elevenlabs: false,
  openseo: false,
};

const KEY_PLACEHOLDERS: Record<Provider, string> = {
  openrouter: "sk-or-v1-…",
  router: "Your Ramp Router API key",
  gemini: "AIza…",
  linki: "lnk_…",
  bund_ai: "bund_sk_…",
  buffer: "buf_…",
  clay: "clay_…",
  exa: "exa_…",
  firecrawl: "fc-…",
  elevenlabs: "Your ElevenLabs API key",
  openseo: "oseo_…",
};

const PROVIDERS: Provider[] = [
  "openrouter",
  "router",
  "gemini",
  "linki",
  "bund_ai",
  "buffer",
  "clay",
  "exa",
  "firecrawl",
  "elevenlabs",
  "openseo",
];

/**
 * A property's own overrides for each integration — separate from
 * `apps/web/src/app/(app)/settings/integrations/IntegrationsPanel.tsx`,
 * which manages the organization's connections. A provider with no override
 * here falls back to whatever the organization has connected (or nothing, if
 * the organization hasn't either) — `activeConnection` in
 * `@/server/integrations` is the read-side of that fallback.
 */
export function IntegrationsPanel({
  slug,
  connections,
  canManage,
  now,
}: {
  slug: string;
  connections: ProjectConnectionView[];
  canManage: boolean;
  now: number;
}) {
  const byProvider = new Map(connections.map((c) => [c.provider, c]));

  return (
    <Card
      title="Integrations"
      subtitle="Connect a provider here to use it for this property alone, instead of whatever the organization has connected. Leave a provider disconnected to keep using the organization's."
    >
      <div style={{ display: "grid", gap: "var(--space-6)" }}>
        {PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider}
            slug={slug}
            provider={provider}
            view={byProvider.get(provider) ?? { provider, override: null, inherited: null }}
            canManage={canManage}
            now={now}
          />
        ))}
      </div>
    </Card>
  );
}

function ProviderRow({
  slug,
  provider,
  view,
  canManage,
  now,
}: {
  slug: string;
  provider: Provider;
  view: ProjectConnectionView;
  canManage: boolean;
  now: number;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  const { override, inherited } = view;
  const connected = override?.status === "active";
  const errored = override?.status === "error";
  const needsBaseUrl = HAS_BASE_URL[provider];
  const isAi = isAiProvider(provider);
  const defaultModel = isAi ? AI_DEFAULT_MODELS[provider] ?? null : null;

  async function submit() {
    const data = new FormData();
    if (needsBaseUrl) data.set("baseUrl", baseUrl);
    data.set("apiKey", apiKey);
    if (isAi) data.set("model", model);
    const result = await run(() => connectProjectIntegration(slug, provider, data));
    if (result?.ok) {
      setOpen(false);
      setBaseUrl("");
      setApiKey("");
      setModel("");
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-4)",
          paddingBottom: "var(--space-6)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: "var(--size-body-sm)" }}>{LABELS[provider]}</strong>
            {override ? (
              <Badge tone={connected ? "up" : override.status === "revoked" ? "neutral" : "down"}>
                {connected ? "override active" : override.status}
              </Badge>
            ) : inherited?.status === "active" ? (
              <Badge tone="neutral">using organization's</Badge>
            ) : (
              <Badge tone="neutral">not connected</Badge>
            )}
          </div>
          {override ? (
            <div style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: 1.7 }}>
              <div>
                last verified: {override.lastVerifiedAt ? shortDate(override.lastVerifiedAt, now) : "never"}
              </div>
              {errored && override.lastError && (
                <div style={{ color: "var(--signal-down)" }}>error: {override.lastError}</div>
              )}
              {isAi && <div>model: {override.model ?? defaultModel ?? "none chosen"}</div>}
            </div>
          ) : (
            <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", margin: 0 }}>
              {inherited?.status === "active"
                ? "No override for this property — using the organization's connection."
                : "Not connected at the organization level either."}
              {!canManage && " An owner or admin can connect one for this property."}
            </p>
          )}
        </div>

        {canManage && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {override && override.status !== "revoked" ? (
              <>
                {isAi && (
                  <AiModelPicker
                    provider={provider}
                    label={LABELS[provider]}
                    current={override.model}
                    defaultModel={defaultModel}
                    slug={slug}
                    onSave={(next) => setProjectIntegrationModel(slug, provider, next)}
                  />
                )}
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void run(() => testProjectIntegrationConnection(slug, provider), { quiet: false })}
                >
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => void run(() => revokeProjectIntegrationConnection(slug, provider))}
                >
                  Revoke
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" iconLeft={<Icon name="plug" size={13} />} onClick={() => setOpen(true)}>
                {override ? "Reconnect" : "Override"}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Connect ${LABELS[provider]} for this property`}
        subtitle="Overrides the organization's connection whenever this property uses it."
        width={520}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={pending || (needsBaseUrl && !baseUrl.trim()) || !apiKey.trim()}
            >
              {pending ? "Connecting…" : "Connect"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          {needsBaseUrl && (
            <Input
              label="Base URL"
              value={baseUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
              placeholder="https://your-instance.example.com"
              hint={`Where your ${LABELS[provider]} deployment is reachable from this server.`}
            />
          )}
          <Input
            label="API key"
            mono
            value={apiKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
            placeholder={KEY_PLACEHOLDERS[provider]}
            hint="Stored encrypted (AES-256-GCM). Never shown again after this."
          />
          {isAi && (
            <Input
              label="Model (optional)"
              mono
              value={model}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setModel(e.target.value)}
              placeholder={defaultModel ?? "chosen after connecting"}
              hint={
                defaultModel
                  ? `Leave blank for ${defaultModel}. You can pick from the live model list after connecting.`
                  : "Leave blank and pick from the live model list after connecting — this provider has no automatic model."
              }
            />
          )}
        </div>
      </Dialog>
    </>
  );
}
