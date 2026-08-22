"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, decryptCredential, encryptCredential, schema } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { BufferClient, BUFFER_API_ENDPOINT } from "@falorb/buffer-client";
import { ClayClient, CLAY_DEFAULT_BASE_URL } from "@falorb/clay-client";
import { ExaClient, EXA_DEFAULT_BASE_URL, FirecrawlClient, FIRECRAWL_DEFAULT_BASE_URL } from "@falorb/research";
import { ElevenLabsClient, ELEVENLABS_DEFAULT_BASE_URL } from "@falorb/elevenlabs-client";
import { StripeClient, STRIPE_DEFAULT_BASE_URL } from "@falorb/stripe-client";
import { GitHubBlogClient, GITHUB_API_ENDPOINT } from "@falorb/git-blog-client";
import { MigaduClient, MIGADU_API_ENDPOINT } from "@falorb/migadu-client";
import {
  AI_PROVIDER_BASE_URLS,
  AI_PROVIDER_DEFAULT_MODELS,
  AiGatewayClient,
  isAiProvider,
  type AiProvider,
  type GatewayModel,
} from "@falorb/ai";
import { requireProject, requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Connect, test, or revoke Falorb's connection to Linki, Bund AI, Buffer,
 * Clay, Exa, Firecrawl, ElevenLabs, Stripe, or one of the three AI providers
 * (OpenRouter, Ramp Router, Google Gemini) — at the organization level (this file) or, via
 * the `*ProjectIntegration*` actions below, overriding it for one property.
 * A property with its own connection for a provider uses that one; a
 * property with none falls back to the organization's (see
 * `activeConnection` in `@/server/integrations`).
 *
 * Duplicates what `apps/api/src/routes/integrations.ts` exposes over HTTP,
 * deliberately — same reasoning as every other server action in this
 * directory (see `project.ts`): the dashboard is a browser with a session
 * cookie already authenticated, and every write here is scoped by
 * organization in the WHERE clause rather than checked beforehand.
 *
 * Gated at `manageIntegrations` (admin), not `actOnIntegrations` (member) —
 * storing or revoking the credential itself is a different, higher-trust act
 * than using an already-connected one, the same split `keys.ts` draws
 * between issuing an API key and using one.
 */

export type Provider =
  | "linki"
  | "bund_ai"
  | "buffer"
  | "clay"
  | "exa"
  | "firecrawl"
  | "elevenlabs"
  | "stripe"
  | "github"
  | "migadu"
  | AiProvider;

const LABELS: Record<Provider, string> = {
  linki: "Linki",
  bund_ai: "Bund AI",
  buffer: "Buffer",
  clay: "Clay",
  exa: "Exa",
  firecrawl: "Firecrawl",
  elevenlabs: "ElevenLabs",
  stripe: "Stripe",
  github: "GitHub",
  migadu: "Migadu",
  openrouter: "OpenRouter",
  router: "Ramp Router",
  gemini: "Google Gemini",
};

/** Migadu is the one provider whose management API needs a second secret
 * (an admin email, alongside the API key) — see `packages/db/src/schema/integrations.ts`. */
const NEEDS_USERNAME: Partial<Record<Provider, true>> = { migadu: true };

/**
 * Buffer, Clay, Exa, Firecrawl, ElevenLabs, Stripe, GitHub, Migadu, and both
 * AI gateways each have one fixed API root, unlike Linki/Bund AI's
 * self-hosted deployments — their connect forms carry no baseUrl field at
 * all, so the fixed root is supplied here rather than asked of the user.
 */
const FIXED_BASE_URLS: Partial<Record<Provider, string>> = {
  buffer: BUFFER_API_ENDPOINT,
  clay: CLAY_DEFAULT_BASE_URL,
  exa: EXA_DEFAULT_BASE_URL,
  firecrawl: FIRECRAWL_DEFAULT_BASE_URL,
  elevenlabs: ELEVENLABS_DEFAULT_BASE_URL,
  stripe: STRIPE_DEFAULT_BASE_URL,
  github: GITHUB_API_ENDPOINT,
  migadu: MIGADU_API_ENDPOINT,
  openrouter: AI_PROVIDER_BASE_URLS.openrouter,
  router: AI_PROVIDER_BASE_URLS.router,
  gemini: AI_PROVIDER_BASE_URLS.gemini,
};

function clientFor(
  provider: Provider,
  baseUrl: string,
  apiKey: string,
):
  | LinkiClient
  | BundAiClient
  | BufferClient
  | ClayClient
  | ExaClient
  | FirecrawlClient
  | ElevenLabsClient
  | StripeClient
  | GitHubBlogClient
  | MigaduClient
  | AiGatewayClient {
  if (isAiProvider(provider)) return new AiGatewayClient({ provider, baseUrl, apiKey });
  if (provider === "linki") return new LinkiClient({ baseUrl, apiKey });
  if (provider === "bund_ai") return new BundAiClient({ baseUrl, apiKey });
  if (provider === "buffer") return new BufferClient({ baseUrl, apiKey });
  if (provider === "clay") return new ClayClient({ baseUrl, apiKey });
  if (provider === "exa") return new ExaClient({ baseUrl, apiKey });
  if (provider === "firecrawl") return new FirecrawlClient({ baseUrl, apiKey });
  if (provider === "elevenlabs") return new ElevenLabsClient({ baseUrl, apiKey });
  if (provider === "github") return new GitHubBlogClient({ baseUrl, apiKey });
  if (provider === "migadu") return new MigaduClient({ baseUrl, apiKey });
  return new StripeClient({ baseUrl, apiKey });
}

function isProvider(value: string): value is Provider {
  return (
    isAiProvider(value) ||
    value === "linki" ||
    value === "bund_ai" ||
    value === "buffer" ||
    value === "clay" ||
    value === "exa" ||
    value === "firecrawl" ||
    value === "elevenlabs" ||
    value === "stripe" ||
    value === "github" ||
    value === "migadu"
  );
}

/** The repo config fields the GitHub connect form carries, beyond the generic apiKey/baseUrl every provider has. */
interface RepoConfigInput {
  owner: string;
  repo: string;
  branch?: string;
  pathTemplate?: string;
  frontmatterTemplate?: string;
}

function repoConfigFrom(provider: Provider, formData: FormData): RepoConfigInput | null {
  if (provider !== "github") return null;
  const owner = String(formData.get("owner") ?? "").trim();
  const repo = String(formData.get("repo") ?? "").trim();
  if (!owner || !repo) return null;
  return {
    owner,
    repo,
    branch: String(formData.get("branch") ?? "").trim() || undefined,
    pathTemplate: String(formData.get("pathTemplate") ?? "").trim() || undefined,
    frontmatterTemplate: String(formData.get("frontmatterTemplate") ?? "").trim() || undefined,
  };
}

/** Combines the connect form's `apiKey` with `username` for providers that need
 * both (Migadu) into the single string this table's `encryptedApiKey` column
 * stores — see `NEEDS_USERNAME`. */
function credentialFor(provider: Provider, formData: FormData): { credential: string; error?: string } {
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) return { credential: "", error: "Enter the API key." };
  if (!NEEDS_USERNAME[provider]) return { credential: apiKey };
  const username = String(formData.get("username") ?? "").trim();
  if (!username) return { credential: "", error: "Enter the admin email." };
  return { credential: JSON.stringify({ username, apiKey }) };
}

/**
 * Shared write path for both org-level connections (`projectId: null`) and a
 * property's own override (`projectId` set). Which of the two partial unique
 * indexes on `integration_connections` (`packages/db/src/schema/integrations.ts`)
 * is the upsert's conflict target depends on scope, so `targetWhere` has to
 * match: a plain `target` without it doesn't identify either partial index to
 * Postgres and the insert fails with "no unique or exclusion constraint
 * matching the ON CONFLICT specification".
 *
 * `verifyConnection()` and `encryptCredential()` are deliberately not
 * guarded here: every client's own `verifyConnection()` already catches its
 * network errors and returns `{ ok: false }`, so a throw reaching this point
 * means something more fundamental — almost always `encryptCredential()`
 * rejecting a missing or malformed `INTEGRATION_CREDENTIAL_ENC_KEY`. Left
 * unguarded here, Next.js would redact it to an opaque digest-only error in
 * production; both callers below (`connectIntegration`,
 * `connectProjectIntegration`) catch it instead and surface the real
 * message as an `ActionResult`, the same way `content-draft.ts` and every
 * other AI/integration-backed action in this directory turn an unexpected
 * throw into a toast rather than an unhandled exception.
 */
async function upsertConnection(
  scope: { organizationId: string; projectId: number | null },
  provider: Provider,
  baseUrl: string,
  apiKey: string,
  model: string | null,
  actorId: string,
  repoConfig?: RepoConfigInput | null,
): Promise<{ id: string; verified: boolean; detail: string }> {
  const client = clientFor(provider, baseUrl, apiKey);
  const check =
    provider === "github"
      ? await (client as GitHubBlogClient).verifyConnection(repoConfig?.owner, repoConfig?.repo)
      : await client.verifyConnection();
  const encrypted = encryptCredential(apiKey);

  // The connection row and (for github) its `blogPublishTargets` row either
  // both land or neither does — a connection with no repo config would pass
  // `verifyConnection` but have nowhere to actually publish to.
  const rowId = await db().transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.integrationConnections)
      .values({
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        provider,
        baseUrl,
        encryptedApiKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        model,
        status: check.ok ? "active" : "error",
        lastVerifiedAt: check.ok ? new Date() : null,
        lastError: check.ok ? null : check.detail,
        createdBy: actorId,
      })
      .onConflictDoUpdate(
        scope.projectId === null
          ? {
              target: [schema.integrationConnections.organizationId, schema.integrationConnections.provider],
              targetWhere: sql`${schema.integrationConnections.projectId} is null`,
              set: {
                baseUrl,
                encryptedApiKey: encrypted.ciphertext,
                iv: encrypted.iv,
                authTag: encrypted.authTag,
                model,
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
                model,
                status: check.ok ? "active" : "error",
                lastVerifiedAt: check.ok ? new Date() : null,
                lastError: check.ok ? null : check.detail,
                revokedAt: null,
                updatedAt: new Date(),
              },
            },
      )
      .returning();

    if (provider === "github" && repoConfig) {
      await tx
        .insert(schema.blogPublishTargets)
        .values({
          integrationConnectionId: row!.id,
          owner: repoConfig.owner,
          repo: repoConfig.repo,
          ...(repoConfig.branch ? { branch: repoConfig.branch } : {}),
          ...(repoConfig.pathTemplate ? { pathTemplate: repoConfig.pathTemplate } : {}),
          ...(repoConfig.frontmatterTemplate ? { frontmatterTemplate: repoConfig.frontmatterTemplate } : {}),
        })
        .onConflictDoUpdate({
          target: schema.blogPublishTargets.integrationConnectionId,
          set: {
            owner: repoConfig.owner,
            repo: repoConfig.repo,
            // Blank on a reconnect means "leave as-is," not "clear it" — a PAT
            // rotation shouldn't silently wipe a template someone configured
            // via the API and never re-enters through this form.
            ...(repoConfig.branch ? { branch: repoConfig.branch } : {}),
            ...(repoConfig.pathTemplate ? { pathTemplate: repoConfig.pathTemplate } : {}),
            ...(repoConfig.frontmatterTemplate ? { frontmatterTemplate: repoConfig.frontmatterTemplate } : {}),
            updatedAt: new Date(),
          },
        });
    }

    return row!.id;
  });

  audit(db(), {
    organizationId: scope.organizationId,
    actorId,
    action: AUDIT_ACTIONS.integrationConnected,
    targetType: "integration_connection",
    targetId: rowId,
    metadata: { provider, baseUrl, model, verified: check.ok, projectId: scope.projectId },
  });

  return { id: rowId, verified: check.ok, detail: check.detail };
}

/** `projectId: null` selects the org-level row; a project's WHERE clause always adds `isNull` exclusion so it never touches another property's override or the org's row. */
async function testConnection(
  scope: { organizationId: string; projectId: number | null },
  provider: Provider,
): Promise<ActionResult> {
  const [row] = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, scope.organizationId),
        scope.projectId === null
          ? isNull(schema.integrationConnections.projectId)
          : eq(schema.integrationConnections.projectId, scope.projectId),
        eq(schema.integrationConnections.provider, provider),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, message: `No ${LABELS[provider]} connection yet.` };
  if (row.status === "revoked") return { ok: false, message: "This connection has been revoked." };

  let check: Awaited<ReturnType<ReturnType<typeof clientFor>["verifyConnection"]>>;
  try {
    const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
    const client = clientFor(provider, row.baseUrl, apiKey);
    if (provider === "github") {
      const [target] = await db()
        .select({ owner: schema.blogPublishTargets.owner, repo: schema.blogPublishTargets.repo })
        .from(schema.blogPublishTargets)
        .where(eq(schema.blogPublishTargets.integrationConnectionId, row.id))
        .limit(1);
      check = await (client as GitHubBlogClient).verifyConnection(target?.owner, target?.repo);
    } else {
      check = await client.verifyConnection();
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : `Could not test the ${LABELS[provider]} connection.`,
    };
  }

  await db()
    .update(schema.integrationConnections)
    .set({
      status: check.ok ? "active" : "error",
      lastVerifiedAt: check.ok ? new Date() : row.lastVerifiedAt,
      lastError: check.ok ? null : check.detail,
      updatedAt: new Date(),
    })
    .where(eq(schema.integrationConnections.id, row.id));

  return check.ok ? { ok: true, message: check.detail } : { ok: false, message: check.detail };
}

async function revokeConnection(
  scope: { organizationId: string; projectId: number | null },
  provider: Provider,
  actorId: string,
): Promise<ActionResult> {
  const [revoked] = await db()
    .update(schema.integrationConnections)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.integrationConnections.organizationId, scope.organizationId),
        scope.projectId === null
          ? isNull(schema.integrationConnections.projectId)
          : eq(schema.integrationConnections.projectId, scope.projectId),
        eq(schema.integrationConnections.provider, provider),
      ),
    )
    .returning();
  if (!revoked) return { ok: false, message: `No ${LABELS[provider]} connection to revoke.` };

  audit(db(), {
    organizationId: scope.organizationId,
    actorId,
    action: AUDIT_ACTIONS.integrationRevoked,
    targetType: "integration_connection",
    targetId: revoked.id,
    metadata: { provider, projectId: scope.projectId },
  });

  return { ok: true, message: `${LABELS[provider]} disconnected.` };
}

/**
 * The model field on the connect form — only the AI gateways have one, and
 * only they store anything in the column. Blank means "the provider's
 * default", which is `openrouter/auto` on OpenRouter and, on Ramp Router and Gemini,
 * nothing at all: it has no auto model, so a connection there is verified
 * but unusable until a model is chosen, which is what the panel says.
 */
function modelFrom(provider: Provider, formData: FormData): string | null {
  if (!isAiProvider(provider)) return null;
  return String(formData.get("model") ?? "").trim() || null;
}

/**
 * The model ids the stored key can actually call, for the model picker.
 * Read-only and gated at `manageIntegrations` like the rest of this file —
 * it is asked on behalf of a stored credential, so it is not a public list
 * even though OpenRouter's own catalogue is.
 *
 * `slug` selects a property's own connection instead of the organization's;
 * omitted, it reads the org-level row.
 */
export async function listAiGatewayModels(
  provider: string,
  slug?: string,
): Promise<{ ok: true; models: GatewayModel[] } | { ok: false; message: string }> {
  const { session, projectId } = slug
    ? await requireProject(slug).then((r) => ({ session: r.session, projectId: r.project.id as number | null }))
    : await requireSession().then((s) => ({ session: s, projectId: null as number | null }));

  if (!isAiProvider(provider)) return { ok: false, message: "Unknown AI provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `list ${LABELS[provider]} models`);
  if (refusal) return { ok: false, message: refusal.message ?? "You do not have permission to do that." };

  const [row] = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, session.workspace.organizationId),
        projectId === null
          ? isNull(schema.integrationConnections.projectId)
          : eq(schema.integrationConnections.projectId, projectId),
        eq(schema.integrationConnections.provider, provider),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, message: `No ${LABELS[provider]} connection yet.` };
  if (row.status === "revoked") return { ok: false, message: "This connection has been revoked." };

  try {
    const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
    const models = await new AiGatewayClient({ provider, baseUrl: row.baseUrl, apiKey }).listModels();
    return { ok: true, models };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : `Could not list ${LABELS[provider]} models.`,
    };
  }
}

/**
 * Change which model a connected gateway is asked for, without re-entering
 * the key — the "bring your own model" half of the integration. Blank
 * clears it back to the provider's default (`openrouter/auto`, or nothing
 * on Ramp Router).
 *
 * Deliberately not verified against the gateway's model list first: the two
 * gateways add and retire models constantly, and refusing a model the list
 * hasn't caught up with would be a worse failure than the clear upstream
 * error a genuinely wrong id produces on the next call.
 */
async function setModel(
  scope: { organizationId: string; projectId: number | null },
  provider: AiProvider,
  model: string | null,
): Promise<ActionResult> {
  const [updated] = await db()
    .update(schema.integrationConnections)
    .set({ model, updatedAt: new Date() })
    .where(
      and(
        eq(schema.integrationConnections.organizationId, scope.organizationId),
        scope.projectId === null
          ? isNull(schema.integrationConnections.projectId)
          : eq(schema.integrationConnections.projectId, scope.projectId),
        eq(schema.integrationConnections.provider, provider),
      ),
    )
    .returning();
  if (!updated) return { ok: false, message: `No ${LABELS[provider]} connection to update.` };

  const shown = model ?? AI_PROVIDER_DEFAULT_MODELS[provider];
  return {
    ok: true,
    message: shown ? `${LABELS[provider]} will use ${shown}.` : `${LABELS[provider]} model cleared.`,
  };
}

export async function setIntegrationModel(provider: string, model: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isAiProvider(provider)) return { ok: false, message: "Unknown AI provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `change the ${LABELS[provider]} model`);
  if (refusal) return refusal;

  const result = await setModel(
    { organizationId: session.workspace.organizationId, projectId: null },
    provider,
    model.trim() || null,
  );
  revalidatePath("/settings/integrations");
  return result;
}

export async function setProjectIntegrationModel(
  slug: string,
  provider: string,
  model: string,
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);
  if (!isAiProvider(provider)) return { ok: false, message: "Unknown AI provider." };

  const refusal = deny(
    session.workspace.role,
    "manageIntegrations",
    `change the ${LABELS[provider]} model for this property`,
  );
  if (refusal) return refusal;

  const result = await setModel(
    { organizationId: session.workspace.organizationId, projectId: project.id },
    provider,
    model.trim() || null,
  );
  revalidatePath(`/p/${slug}/settings`);
  return result;
}

export async function connectIntegration(provider: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `connect ${LABELS[provider]}`);
  if (refusal) return refusal;

  const fixedBaseUrl = FIXED_BASE_URLS[provider];
  const baseUrl = fixedBaseUrl ?? String(formData.get("baseUrl") ?? "").trim();
  if (!fixedBaseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
    return { ok: false, message: "Enter a valid base URL." };
  }
  const { credential, error } = credentialFor(provider, formData);
  if (error) return { ok: false, message: error };
  const repoConfig = repoConfigFrom(provider, formData);
  if (provider === "github" && !repoConfig) {
    return { ok: false, message: "Enter the repo owner and name to publish to." };
  }

  let result: Awaited<ReturnType<typeof upsertConnection>>;
  try {
    result = await upsertConnection(
      { organizationId: session.workspace.organizationId, projectId: null },
      provider,
      baseUrl,
      credential,
      modelFrom(provider, formData),
      session.user.id,
      repoConfig,
    );
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `Could not connect ${LABELS[provider]}.` };
  }

  revalidatePath("/settings/integrations");
  if (!result.verified) return { ok: false, message: `Saved, but ${LABELS[provider]} rejected it: ${result.detail}` };
  return { ok: true, message: `${LABELS[provider]} connected.` };
}

/**
 * Same as `connectIntegration`, but stores the credential as this property's
 * own override instead of the organization's — `activeConnection`
 * (`@/server/integrations`) prefers it over the org's connection for this
 * provider whenever this project is the one asking.
 */
export async function connectProjectIntegration(
  slug: string,
  provider: string,
  formData: FormData,
): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `connect ${LABELS[provider]} for this property`);
  if (refusal) return refusal;

  const fixedBaseUrl = FIXED_BASE_URLS[provider];
  const baseUrl = fixedBaseUrl ?? String(formData.get("baseUrl") ?? "").trim();
  if (!fixedBaseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
    return { ok: false, message: "Enter a valid base URL." };
  }
  const { credential, error } = credentialFor(provider, formData);
  if (error) return { ok: false, message: error };
  const repoConfig = repoConfigFrom(provider, formData);
  if (provider === "github" && !repoConfig) {
    return { ok: false, message: "Enter the repo owner and name to publish to." };
  }

  let result: Awaited<ReturnType<typeof upsertConnection>>;
  try {
    result = await upsertConnection(
      { organizationId: session.workspace.organizationId, projectId: project.id },
      provider,
      baseUrl,
      credential,
      modelFrom(provider, formData),
      session.user.id,
      repoConfig,
    );
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `Could not connect ${LABELS[provider]}.` };
  }

  revalidatePath(`/p/${slug}/settings`);
  if (!result.verified) return { ok: false, message: `Saved, but ${LABELS[provider]} rejected it: ${result.detail}` };
  return { ok: true, message: `${LABELS[provider]} connected for this property.` };
}

export async function testIntegrationConnection(provider: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `test the ${LABELS[provider]} connection`);
  if (refusal) return refusal;

  const result = await testConnection({ organizationId: session.workspace.organizationId, projectId: null }, provider);
  revalidatePath("/settings/integrations");
  return result;
}

export async function testProjectIntegrationConnection(slug: string, provider: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(
    session.workspace.role,
    "manageIntegrations",
    `test the ${LABELS[provider]} connection for this property`,
  );
  if (refusal) return refusal;

  const result = await testConnection(
    { organizationId: session.workspace.organizationId, projectId: project.id },
    provider,
  );
  revalidatePath(`/p/${slug}/settings`);
  return result;
}

export async function revokeIntegrationConnection(provider: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `revoke the ${LABELS[provider]} connection`);
  if (refusal) return refusal;

  const result = await revokeConnection(
    { organizationId: session.workspace.organizationId, projectId: null },
    provider,
    session.user.id,
  );
  revalidatePath("/settings/integrations");
  return result;
}

export async function revokeProjectIntegrationConnection(slug: string, provider: string): Promise<ActionResult> {
  const { session, project } = await requireProject(slug);
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(
    session.workspace.role,
    "manageIntegrations",
    `revoke the ${LABELS[provider]} connection for this property`,
  );
  if (refusal) return refusal;

  const result = await revokeConnection(
    { organizationId: session.workspace.organizationId, projectId: project.id },
    provider,
    session.user.id,
  );
  revalidatePath(`/p/${slug}/settings`);
  return result;
}
