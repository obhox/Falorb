import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { decryptCredential, encryptCredential, schema } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { BufferClient, BUFFER_API_ENDPOINT } from "@falorb/buffer-client";
import { ClayClient, CLAY_DEFAULT_BASE_URL } from "@falorb/clay-client";
import {
  ExaClient,
  EXA_DEFAULT_BASE_URL,
  FirecrawlClient,
  FIRECRAWL_DEFAULT_BASE_URL,
} from "@falorb/research";
import { ElevenLabsClient, ELEVENLABS_DEFAULT_BASE_URL } from "@falorb/elevenlabs-client";
import { AI_PROVIDER_BASE_URLS, AiGatewayClient, isAiProvider } from "@falorb/ai";
import type { McpContext } from "../context";
import { projectName, requireLocalOperator, resolveProjects } from "../context";
import { ago, failure, table, text } from "../format";

const PROVIDERS = [
  "linki",
  "bund_ai",
  "buffer",
  "postiz",
  "clay",
  "exa",
  "firecrawl",
  "elevenlabs",
  "openrouter",
  "router",
  "gemini",
] as const;

/** Postiz is a reserved provider value with no client built yet (FEATURES.md §13) — every write tool below excludes it. */
const WRITABLE_PROVIDERS = PROVIDERS.filter((p) => p !== "postiz");
type WritableProvider = Exclude<(typeof PROVIDERS)[number], "postiz">;

const LABELS: Record<(typeof PROVIDERS)[number], string> = {
  linki: "Linki",
  bund_ai: "Bund AI",
  buffer: "Buffer",
  postiz: "Postiz",
  clay: "Clay",
  exa: "Exa",
  firecrawl: "Firecrawl",
  elevenlabs: "ElevenLabs",
  openrouter: "OpenRouter",
  router: "Ramp Router",
  gemini: "Google Gemini",
};

/** Every provider but Linki/Bund AI has one fixed API root — no baseUrl field to ask for. */
const FIXED_BASE_URLS: Partial<Record<WritableProvider, string>> = {
  buffer: BUFFER_API_ENDPOINT,
  clay: CLAY_DEFAULT_BASE_URL,
  exa: EXA_DEFAULT_BASE_URL,
  firecrawl: FIRECRAWL_DEFAULT_BASE_URL,
  elevenlabs: ELEVENLABS_DEFAULT_BASE_URL,
  openrouter: AI_PROVIDER_BASE_URLS.openrouter,
  router: AI_PROVIDER_BASE_URLS.router,
  gemini: AI_PROVIDER_BASE_URLS.gemini,
};

function clientFor(provider: WritableProvider, baseUrl: string, apiKey: string) {
  if (isAiProvider(provider)) return new AiGatewayClient({ provider, baseUrl, apiKey });
  if (provider === "linki") return new LinkiClient({ baseUrl, apiKey });
  if (provider === "bund_ai") return new BundAiClient({ baseUrl, apiKey });
  if (provider === "buffer") return new BufferClient({ baseUrl, apiKey });
  if (provider === "clay") return new ClayClient({ baseUrl, apiKey });
  if (provider === "exa") return new ExaClient({ baseUrl, apiKey });
  if (provider === "firecrawl") return new FirecrawlClient({ baseUrl, apiKey });
  return new ElevenLabsClient({ baseUrl, apiKey });
}

/**
 * Integration connections — every provider in `integrationConnections` (see
 * FEATURES.md §13/§13c): the CRM/support/social mirrors, the two research
 * providers, ElevenLabs, and the three AI gateways an org can bring its own
 * key to.
 *
 * `get_integration_status` is a normal read tool, reachable by any key with
 * the default `read` scope — it reports only whether a credential is
 * connected and healthy, never the credential itself
 * (`encryptedApiKey`/`iv`/`authTag` are never selected). The five tools below
 * it store, test, rotate, or revoke the credential, and require
 * `requireLocalOperator` rather than just the `write` scope: every one of
 * them mirrors an action `apps/api/src/routes/integrations.ts` refuses to
 * *any* bearer API key via `requireHumanSession`, no scope exception —
 * "sign in to the dashboard to do this." A stdio operator already holds the
 * database credentials to do this directly; a bearer key is exactly the
 * shape every remote MCP client authenticates with, which is the case that
 * route was written to exclude.
 */
export function registerIntegrationTools(server: McpServer, ctx: () => McpContext): void {
  server.registerTool(
    "get_integration_status",
    {
      title: "Integration connection status",
      description:
        "Which third-party integrations are connected, whether they're healthy, and when each " +
        "last synced or was verified — Linki, Bund AI, Buffer, Clay, Exa, Firecrawl, ElevenLabs, " +
        "and the AI gateways (OpenRouter, Router, Gemini). Shows organization-level connections by " +
        "default; pass a project to also see that property's own override, if it has one.",
      inputSchema: {
        provider: z.enum(PROVIDERS).optional().describe("Limit to one provider."),
        project: z
          .string()
          .optional()
          .describe("Project slug — also shows this property's own connection override, if set."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ provider, project }) => {
      const { db, scope } = ctx();
      try {
        const projectId = project ? resolveProjects(scope, project)[0] : undefined;

        const conditions = [eq(schema.integrationConnections.organizationId, scope.organizationId)];
        if (provider) conditions.push(eq(schema.integrationConnections.provider, provider));

        const rows = await db
          .select({
            provider: schema.integrationConnections.provider,
            projectId: schema.integrationConnections.projectId,
            model: schema.integrationConnections.model,
            status: schema.integrationConnections.status,
            lastVerifiedAt: schema.integrationConnections.lastVerifiedAt,
            lastSyncedAt: schema.integrationConnections.lastSyncedAt,
            lastError: schema.integrationConnections.lastError,
            revokedAt: schema.integrationConnections.revokedAt,
          })
          .from(schema.integrationConnections)
          .where(and(...conditions))
          .orderBy(asc(schema.integrationConnections.provider));

        const visible = rows.filter((r) => r.projectId === null || r.projectId === projectId);

        return text(
          table(
            visible,
            [
              { header: "Provider", get: (r) => r.provider },
              { header: "Scope", get: (r) => (r.projectId ? projectName(scope, r.projectId) : "organization") },
              { header: "Status", get: (r) => (r.revokedAt ? "revoked" : r.status) },
              { header: "Model", get: (r) => r.model },
              { header: "Last synced", get: (r) => (r.lastSyncedAt ? ago(r.lastSyncedAt.toISOString()) : "—") },
              { header: "Last verified", get: (r) => (r.lastVerifiedAt ? ago(r.lastVerifiedAt.toISOString()) : "—") },
              { header: "Last error", get: (r) => r.lastError },
            ],
            "Nothing connected. Connect a provider under Settings → Integrations.",
          ) +
            "\n\nConnecting, disconnecting, or rotating a credential is dashboard-only " +
            "(Settings → Integrations), not available here. A property with no row of its own " +
            "falls back to the organization's connection for that provider.",
        );
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "connect_integration",
    {
      title: "Connect (or reconnect) an integration",
      description:
        "Store an API key for a provider, verifying it on the spot. Reconnecting the same " +
        "provider rotates the stored key. Pass a project to store it as that property's own " +
        "override instead of the organization's connection — see get_integration_status for the " +
        "fallback rule. Local operator only (stdio): refused to every bearer API key, the same " +
        "rule the dashboard's own API enforces for this action.",
      inputSchema: {
        provider: z.enum(WRITABLE_PROVIDERS as unknown as [WritableProvider, ...WritableProvider[]]),
        api_key: z.string().min(1),
        base_url: z.string().url().optional().describe("Required only for Linki/Bund AI (self-hosted); every other provider has a fixed root."),
        model: z.string().optional().describe("AI gateways only (openrouter/router/gemini). Blank means the provider's default."),
        project: z.string().optional().describe("Project slug — connect for this property only, instead of the organization."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ provider, api_key, base_url, model, project }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, `connect ${LABELS[provider]}`);
        const projectId = project ? (resolveProjects(scope, project)[0] ?? null) : null;

        const fixedBaseUrl = FIXED_BASE_URLS[provider];
        const baseUrl = fixedBaseUrl ?? base_url?.trim();
        if (!baseUrl) return failure(`base_url is required for ${LABELS[provider]}.`);

        const check = await clientFor(provider, baseUrl, api_key).verifyConnection();
        let encrypted;
        try {
          encrypted = encryptCredential(api_key);
        } catch (error) {
          return failure(message(error));
        }
        const modelValue = isAiProvider(provider) ? model?.trim() || null : null;

        const [row] = await db
          .insert(schema.integrationConnections)
          .values({
            organizationId: scope.organizationId,
            projectId,
            provider,
            baseUrl,
            encryptedApiKey: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            model: modelValue,
            status: check.ok ? "active" : "error",
            lastVerifiedAt: check.ok ? new Date() : null,
            lastError: check.ok ? null : check.detail,
          })
          .onConflictDoUpdate(
            projectId === null
              ? {
                  target: [schema.integrationConnections.organizationId, schema.integrationConnections.provider],
                  targetWhere: sql`${schema.integrationConnections.projectId} is null`,
                  set: {
                    baseUrl,
                    encryptedApiKey: encrypted.ciphertext,
                    iv: encrypted.iv,
                    authTag: encrypted.authTag,
                    model: modelValue,
                    status: check.ok ? "active" : "error",
                    lastVerifiedAt: check.ok ? new Date() : null,
                    lastError: check.ok ? null : check.detail,
                    revokedAt: null,
                    updatedAt: new Date(),
                  },
                }
              : {
                  target: [
                    schema.integrationConnections.organizationId,
                    schema.integrationConnections.projectId,
                    schema.integrationConnections.provider,
                  ],
                  targetWhere: sql`${schema.integrationConnections.projectId} is not null`,
                  set: {
                    baseUrl,
                    encryptedApiKey: encrypted.ciphertext,
                    iv: encrypted.iv,
                    authTag: encrypted.authTag,
                    model: modelValue,
                    status: check.ok ? "active" : "error",
                    lastVerifiedAt: check.ok ? new Date() : null,
                    lastError: check.ok ? null : check.detail,
                    revokedAt: null,
                    updatedAt: new Date(),
                  },
                },
          )
          .returning({ id: schema.integrationConnections.id });

        if (!check.ok) {
          return failure(`Saved, but ${LABELS[provider]} rejected it: ${check.detail} (connection id \`${row!.id}\`).`);
        }
        return text(`${LABELS[provider]} connected${projectId ? " for this property" : ""}. ${check.detail}`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "test_integration_connection",
    {
      title: "Test a stored integration connection",
      description:
        "Re-verify a stored credential against the provider right now, and update its recorded " +
        "status. Local operator only (stdio) — same rule as connect_integration.",
      inputSchema: {
        provider: z.enum(WRITABLE_PROVIDERS as unknown as [WritableProvider, ...WritableProvider[]]),
        project: z.string().optional().describe("Project slug — test this property's own override, if it has one."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ provider, project }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, `test the ${LABELS[provider]} connection`);
        const projectId = project ? (resolveProjects(scope, project)[0] ?? null) : null;

        const [row] = await db
          .select()
          .from(schema.integrationConnections)
          .where(
            and(
              eq(schema.integrationConnections.organizationId, scope.organizationId),
              projectId === null
                ? isNull(schema.integrationConnections.projectId)
                : eq(schema.integrationConnections.projectId, projectId),
              eq(schema.integrationConnections.provider, provider),
            ),
          )
          .limit(1);
        if (!row) return failure(`No ${LABELS[provider]} connection yet.`);
        if (row.status === "revoked") return failure("This connection has been revoked.");

        const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
        const check = await clientFor(provider, row.baseUrl, apiKey).verifyConnection();

        await db
          .update(schema.integrationConnections)
          .set({
            status: check.ok ? "active" : "error",
            lastVerifiedAt: check.ok ? new Date() : row.lastVerifiedAt,
            lastError: check.ok ? null : check.detail,
            updatedAt: new Date(),
          })
          .where(eq(schema.integrationConnections.id, row.id));

        return check.ok ? text(check.detail) : failure(check.detail);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "revoke_integration_connection",
    {
      title: "Revoke an integration connection",
      description:
        "Mark a stored connection revoked. The row and its credential stay (for audit purposes) " +
        "but the connection is no longer used for syncing or writes. Local operator only (stdio) " +
        "— same rule as connect_integration.",
      inputSchema: {
        provider: z.enum(WRITABLE_PROVIDERS as unknown as [WritableProvider, ...WritableProvider[]]),
        project: z.string().optional().describe("Project slug — revoke this property's own override, if it has one."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ provider, project }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, `revoke the ${LABELS[provider]} connection`);
        const projectId = project ? (resolveProjects(scope, project)[0] ?? null) : null;

        const [revoked] = await db
          .update(schema.integrationConnections)
          .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(schema.integrationConnections.organizationId, scope.organizationId),
              projectId === null
                ? isNull(schema.integrationConnections.projectId)
                : eq(schema.integrationConnections.projectId, projectId),
              eq(schema.integrationConnections.provider, provider),
            ),
          )
          .returning();
        if (!revoked) return failure(`No ${LABELS[provider]} connection to revoke.`);

        return text(`${LABELS[provider]} disconnected.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );

  server.registerTool(
    "set_integration_model",
    {
      title: "Change an AI gateway's model",
      description:
        "Change which model a connected AI gateway (OpenRouter, Router, or Gemini) is asked for, " +
        "without re-entering the key. Blank clears it back to the provider's default. Not verified " +
        "against the gateway's model list first — both gateways change their catalogues constantly. " +
        "Local operator only (stdio) — same rule as connect_integration.",
      inputSchema: {
        provider: z.enum(["openrouter", "router", "gemini"]),
        model: z.string().optional().describe("Blank clears it back to the default."),
        project: z.string().optional().describe("Project slug — change this property's own override, if it has one."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ provider, model, project }) => {
      const { db, scope } = ctx();
      try {
        requireLocalOperator(scope, `change the ${LABELS[provider]} model`);
        const projectId = project ? (resolveProjects(scope, project)[0] ?? null) : null;

        const [updated] = await db
          .update(schema.integrationConnections)
          .set({ model: model?.trim() || null, updatedAt: new Date() })
          .where(
            and(
              eq(schema.integrationConnections.organizationId, scope.organizationId),
              projectId === null
                ? isNull(schema.integrationConnections.projectId)
                : eq(schema.integrationConnections.projectId, projectId),
              eq(schema.integrationConnections.provider, provider),
            ),
          )
          .returning();
        if (!updated) return failure(`No ${LABELS[provider]} connection to update.`);

        return text(model?.trim() ? `${LABELS[provider]} will use ${model.trim()}.` : `${LABELS[provider]} model cleared.`);
      } catch (error) {
        return failure(message(error));
      }
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
