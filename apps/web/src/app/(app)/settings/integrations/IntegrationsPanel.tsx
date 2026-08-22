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
  linki: "Linki",
  bund_ai: "Bund AI",
  buffer: "Buffer",
  clay: "Clay",
  exa: "Exa",
  firecrawl: "Firecrawl",
  elevenlabs: "ElevenLabs",
  github: "GitHub",
  migadu: "Migadu",
};
const BLURBS: Record<Provider, string> = {
  openrouter:
    "Bring your own AI. Every AI feature — signals, digests, drafts, agents — runs on this key and this model instead of the platform's. Generate a key at openrouter.ai/keys.",
  router:
    "Bring your own AI, through Ramp Router (router.com) — one key across OpenAI, Anthropic and open models, routed for cost. Generate a key at router.com, then pick a model.",
  gemini:
    "Bring your own AI, straight from Google — Gemini's own API rather than a gateway in front of it. Generate a key at aistudio.google.com/apikey, then pick a model.",
  linki: "Sales outreach & CRM. Generate a scoped key in Linki at Platform → Workspace & API.",
  bund_ai: "AI customer support. Generate a key in Bund AI at Settings → API access.",
  buffer:
    "Social post scheduling. Generate a personal API key in Buffer at Settings → API. One Buffer account per Falorb org — Buffer doesn't offer third-party OAuth today.",
  clay: "Contact enrichment for prospects discovered off-site (see Prospecting). Generate a key in Clay at Settings → API.",
  exa: "Neural web search, grounding content drafts in what already ranks. Generate a key at dashboard.exa.ai/api-keys.",
  firecrawl: "Page scraping, grounding company research in a company's own site. Generate a key at firecrawl.dev/app/api-keys.",
  elevenlabs: "Script, voice, and talking-video generation for UGC videos (see UGC videos). Generate a key in ElevenLabs at Settings → API Keys.",
  github:
    "Own your blog. Falorb commits AI-drafted posts straight to your site's git repo — your existing deploy pipeline ships them live. Generate a fine-grained PAT at github.com/settings/personal-access-tokens, scoped to Contents: Read and write on this one repo.",
  migadu:
    "Cold-outreach mailboxes — provision addresses, send, and track replies from Email. Generate an API key in Migadu at your account's API settings, and enter the admin email it belongs to.",
};

/** Buffer, Clay, Exa, Firecrawl, ElevenLabs, and GitHub each have one fixed
 * API root — unlike Linki/Bund AI's self-hosted deployments, their connect
 * dialogs have no Base URL field to fill in. */
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
  github: false,
  migadu: false,
};

/** Migadu is the one provider whose management API needs a second secret —
 * an admin email, alongside the API key — so its connect dialog carries an
 * extra input the rest don't. */
const HAS_USERNAME: Record<Provider, boolean> = {
  openrouter: false,
  router: false,
  gemini: false,
  linki: false,
  bund_ai: false,
  buffer: false,
  clay: false,
  exa: false,
  firecrawl: false,
  elevenlabs: false,
  github: false,
  migadu: true,
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
  github: "github_pat_…",
  migadu: "Your Migadu API key",
};

/** Shown when `lastSyncedAt` is null — Linki/Bund AI/Buffer/Clay are
 * mirrored by a recurring job; Exa/Firecrawl/ElevenLabs/GitHub have none,
 * they're only ever called synchronously (a content draft, a company
 * research click, a UGC video generation, or a Publish click). */
const NEVER_SYNCED: Record<Provider, string> = {
  openrouter: "not applicable — called on demand, every time an AI feature writes something",
  router: "not applicable — called on demand, every time an AI feature writes something",
  gemini: "not applicable — called on demand, every time an AI feature writes something",
  linki: "never — the mirror job runs every 15 minutes",
  bund_ai: "never — the mirror job runs every 15 minutes",
  buffer: "never — the mirror job runs every 15 minutes",
  clay: "never — enrichment runs every 30 minutes against discovered prospects",
  exa: "not applicable — used on demand when drafting content or researching a company",
  firecrawl: "not applicable — used on demand when drafting content or researching a company",
  elevenlabs: "never — used on demand each time you generate a UGC video, not on a schedule",
  github: "not applicable — used on demand each time you click Publish on a draft",
  migadu: "not applicable — mailboxes sync individually, every 5 minutes (see Email)",
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
  "github",
  "migadu",
];

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
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [owner, setOwner] = useState(connection?.repoConfig?.owner ?? "");
  const [repo, setRepo] = useState(connection?.repoConfig?.repo ?? "");
  const [branch, setBranch] = useState(connection?.repoConfig?.branch ?? "");
  const [pathTemplate, setPathTemplate] = useState(connection?.repoConfig?.pathTemplate ?? "");

  const connected = connection?.status === "active";
  const errored = connection?.status === "error";

  const needsBaseUrl = HAS_BASE_URL[provider];
  const needsUsername = HAS_USERNAME[provider];
  const isAi = isAiProvider(provider);
  const isGithub = provider === "github";
  const defaultModel = isAi ? AI_DEFAULT_MODELS[provider] ?? null : null;

  async function submit() {
    const data = new FormData();
    if (needsBaseUrl) data.set("baseUrl", baseUrl);
    if (needsUsername) data.set("username", username);
    data.set("apiKey", apiKey);
    if (isAi) data.set("model", model);
    if (isGithub) {
      data.set("owner", owner);
      data.set("repo", repo);
      if (branch.trim()) data.set("branch", branch);
      if (pathTemplate.trim()) data.set("pathTemplate", pathTemplate);
    }
    const result = await run(() => connectIntegration(provider, data));
    if (result?.ok) {
      setOpen(false);
      setBaseUrl("");
      setUsername("");
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
              {isGithub && connection.repoConfig && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {connection.repoConfig.owner}/{connection.repoConfig.repo}@{connection.repoConfig.branch}
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
                (needsUsername && !username.trim()) ||
                !apiKey.trim() ||
                (isGithub && (!owner.trim() || !repo.trim()))
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
          {needsUsername && (
            <Input
              label="Admin email"
              value={username}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
              placeholder="admin@yourdomain.com"
              hint={`The ${LABELS[provider]} account login this API key belongs to.`}
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
          {isGithub && (
            <>
              <Input
                label="Repo owner"
                value={owner}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOwner(e.target.value)}
                placeholder="your-org-or-username"
              />
              <Input
                label="Repo name"
                value={repo}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepo(e.target.value)}
                placeholder="your-blog"
              />
              <Input
                label="Branch (optional)"
                value={branch}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBranch(e.target.value)}
                placeholder="main"
                hint="Leave blank for main."
              />
              <Input
                label="Path template (optional)"
                mono
                value={pathTemplate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPathTemplate(e.target.value)}
                placeholder="content/blog/{slug}.md"
                hint="{slug} becomes the post title, kebab-cased. Leave blank for content/blog/{slug}.md."
              />
            </>
          )}
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
