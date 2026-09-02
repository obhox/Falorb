"use client";

import { useState } from "react";
import { Badge, Button, Card, Dialog, Icon, Input } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { relative, shortDate } from "@/lib/format";
import {
  connectIntegration,
  revokeIntegrationConnection,
  setIntegrationModel,
  testIntegrationConnection,
  type Provider,
} from "@/server/actions/integrations";
import type { ConnectionView } from "@/server/integrations";
import { AI_DEFAULT_MODELS, isAiProvider } from "@/lib/ai-providers";
import { AiModelPicker } from "./AiModelPicker";

const LABELS: Record<Provider, string> = {
  openrouter: "OpenRouter",
  router: "Ramp Router",
  gemini: "Google Gemini",
  firecrawl: "Firecrawl",
};
const BLURBS: Record<Provider, string> = {
  openrouter:
    "Bring your own AI. Every AI feature — signals, digests, drafts, agents — runs on this key and this model instead of the platform's. Generate a key at openrouter.ai/keys.",
  router:
    "Bring your own AI, through Ramp Router (router.com) — one key across OpenAI, Anthropic and open models, routed for cost. Generate a key at router.com, then pick a model.",
  gemini:
    "Bring your own AI, straight from Google — Gemini's own API rather than a gateway in front of it. Generate a key at aistudio.google.com/apikey, then pick a model.",
  firecrawl:
    "Web search and page scraping, grounding content drafts in what already ranks and company research in a company's own site. Generate a key at firecrawl.dev/app/api-keys.",
};

/** Every provider has one fixed API root, so no connect dialog carries a
 * Base URL field today. Kept as a map rather than folded away: a
 * self-hosted provider would need it back. */
const HAS_BASE_URL: Record<Provider, boolean> = {
  openrouter: false,
  router: false,
  gemini: false,
  firecrawl: false,
};

const KEY_PLACEHOLDERS: Record<Provider, string> = {
  openrouter: "sk-or-v1-…",
  router: "Your Ramp Router API key",
  gemini: "AIza…",
  firecrawl: "fc-…",
};

/** Shown when `lastSyncedAt` is null — nothing here is mirrored by a
 * recurring job; every provider is called synchronously, when a feature
 * actually needs it. */
const NEVER_SYNCED: Record<Provider, string> = {
  openrouter: "not applicable — called on demand, every time an AI feature writes something",
  router: "not applicable — called on demand, every time an AI feature writes something",
  gemini: "not applicable — called on demand, every time an AI feature writes something",
  firecrawl: "not applicable — used on demand when drafting content or researching a company",
};

const PROVIDERS: Provider[] = ["openrouter", "router", "gemini", "firecrawl"];

/**
 * Which AI provider the organization's AI features are actually running on.
 *
 * All three can be connected at once — an org trying Gemini while keeping
 * its OpenRouter key — so one of them wins, and it should not be a mystery
 * which. The rule matches `getAiCredentials` in `@/server/integrations`
 * exactly: most recently updated active connection. Recomputing it here
 * rather than shipping a flag from the server keeps the two in one place
 * conceptually; if they ever disagree, this is the copy to delete.
 */
function activeAiProvider(connections: ConnectionView[]): ConnectionView["provider"] | null {
  const candidates = connections
    .filter((c) => isAiProvider(c.provider) && c.status === "active")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return candidates[0]?.provider ?? null;
}

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
  const inUse = activeAiProvider(connections);

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      {PROVIDERS.map((provider) => (
        <ProviderCard
          key={provider}
          provider={provider}
          connection={byProvider.get(provider) ?? null}
          canManage={canManage}
          now={now}
          inUse={provider === inUse}
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
  inUse,
}: {
  provider: Provider;
  connection: ConnectionView | null;
  canManage: boolean;
  now: number;
  /** Only meaningful for the AI gateways — see `activeAiProvider`. */
  inUse: boolean;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  const connected = connection?.status === "active";
  const errored = connection?.status === "error";

  const needsBaseUrl = HAS_BASE_URL[provider];
  const isAi = isAiProvider(provider);
  const defaultModel = isAi ? AI_DEFAULT_MODELS[provider] ?? null : null;

  async function submit() {
    const data = new FormData();
    if (needsBaseUrl) data.set("baseUrl", baseUrl);
    data.set("apiKey", apiKey);
    if (isAi) data.set("model", model);
    const result = await run(() => connectIntegration(provider, data));
    if (result?.ok) {
      setOpen(false);
      setBaseUrl("");
      setApiKey("");
      setModel("");
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
              {isAi && connected && <Badge tone={inUse ? "up" : "neutral"}>{inUse ? "in use" : "standby"}</Badge>}
              {needsBaseUrl && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {connection.baseUrl}
                </span>
              )}
            </div>
            <div style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: 1.7 }}>
              <div>
                last synced:{" "}
                {connection.lastSyncedAt ? relative(connection.lastSyncedAt, now) : NEVER_SYNCED[provider]}
              </div>
              <div>
                last verified:{" "}
                {connection.lastVerifiedAt ? shortDate(connection.lastVerifiedAt, now) : "never"}
              </div>
              {errored && connection.lastError && (
                <div style={{ color: "var(--signal-down)" }}>error: {connection.lastError}</div>
              )}
            </div>

            {isAi && connection.status !== "revoked" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>model:</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-micro)" }}>
                  {connection.model ?? defaultModel ?? "none chosen"}
                </span>
                {!connection.model && !defaultModel && (
                  <span style={{ fontSize: "var(--size-micro)", color: "var(--signal-down)" }}>
                    — pick one, or calls on this connection will fail
                  </span>
                )}
                {!connection.model && defaultModel && (
                  <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>(provider default)</span>
                )}
                {canManage && (
                  <AiModelPicker
                    provider={provider}
                    label={LABELS[provider]}
                    current={connection.model}
                    defaultModel={defaultModel}
                    onSave={(next) => setIntegrationModel(provider, next)}
                  />
                )}
              </div>
            )}
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
              disabled={
                pending ||
                (needsBaseUrl && !baseUrl.trim()) ||
                !apiKey.trim()
              }
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
                  ? `Leave blank for ${defaultModel}, the provider's own per-request choice. You can pick from the live model list after connecting.`
                  : "Leave blank and pick from the live model list after connecting — this provider has no automatic model."
              }
            />
          )}
        </div>
      </Dialog>
    </>
  );
}
