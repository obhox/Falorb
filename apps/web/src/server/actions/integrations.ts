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
import { requireProject, requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Connect, test, or revoke Falorb's connection to Linki, Bund AI, Buffer,
 * Clay, Exa, Firecrawl, or ElevenLabs — at the organization level (this
 * file) or, via the `*ProjectIntegration*` actions below, overriding it for
 * one property. A property with its own connection for a provider uses that
 * one; a property with none falls back to the organization's (see
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

export type Provider = "linki" | "bund_ai" | "buffer" | "clay" | "exa" | "firecrawl" | "elevenlabs";

const LABELS: Record<Provider, string> = {
  linki: "Linki",
  bund_ai: "Bund AI",
  buffer: "Buffer",
  clay: "Clay",
  exa: "Exa",
  firecrawl: "Firecrawl",
  elevenlabs: "ElevenLabs",
};

/**
 * Buffer, Clay, Exa, Firecrawl, and ElevenLabs each have one fixed API
 * root, unlike Linki/Bund AI's self-hosted deployments — their connect
 * forms carry no baseUrl field at all, so the fixed root is supplied here
 * rather than asked of the user.
 */
const FIXED_BASE_URLS: Partial<Record<Provider, string>> = {
  buffer: BUFFER_API_ENDPOINT,
  clay: CLAY_DEFAULT_BASE_URL,
  exa: EXA_DEFAULT_BASE_URL,
  firecrawl: FIRECRAWL_DEFAULT_BASE_URL,
  elevenlabs: ELEVENLABS_DEFAULT_BASE_URL,
};

function clientFor(
  provider: Provider,
  baseUrl: string,
  apiKey: string,
): LinkiClient | BundAiClient | BufferClient | ClayClient | ExaClient | FirecrawlClient | ElevenLabsClient {
  if (provider === "linki") return new LinkiClient({ baseUrl, apiKey });
  if (provider === "bund_ai") return new BundAiClient({ baseUrl, apiKey });
  if (provider === "buffer") return new BufferClient({ baseUrl, apiKey });
  if (provider === "clay") return new ClayClient({ baseUrl, apiKey });
  if (provider === "exa") return new ExaClient({ baseUrl, apiKey });
  if (provider === "firecrawl") return new FirecrawlClient({ baseUrl, apiKey });
  return new ElevenLabsClient({ baseUrl, apiKey });
}

function isProvider(value: string): value is Provider {
  return (
    value === "linki" ||
    value === "bund_ai" ||
    value === "buffer" ||
    value === "clay" ||
    value === "exa" ||
    value === "firecrawl" ||
    value === "elevenlabs"
  );
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
  actorId: string,
): Promise<{ id: string; verified: boolean; detail: string }> {
  const check = await clientFor(provider, baseUrl, apiKey).verifyConnection();
  const encrypted = encryptCredential(apiKey);

  const [row] = await db()
    .insert(schema.integrationConnections)
    .values({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      provider,
      baseUrl,
      encryptedApiKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
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
              status: check.ok ? "active" : "error",
              lastVerifiedAt: check.ok ? new Date() : null,
              lastError: check.ok ? null : check.detail,
              revokedAt: null,
              updatedAt: new Date(),
            },
          },
    )
    .returning();

  audit(db(), {
    organizationId: scope.organizationId,
    actorId,
    action: AUDIT_ACTIONS.integrationConnected,
    targetType: "integration_connection",
    targetId: row!.id,
    metadata: { provider, baseUrl, verified: check.ok, projectId: scope.projectId },
  });

  return { id: row!.id, verified: check.ok, detail: check.detail };
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
    check = await clientFor(provider, row.baseUrl, apiKey).verifyConnection();
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

export async function connectIntegration(provider: string, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `connect ${LABELS[provider]}`);
  if (refusal) return refusal;

  const fixedBaseUrl = FIXED_BASE_URLS[provider];
  const baseUrl = fixedBaseUrl ?? String(formData.get("baseUrl") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!fixedBaseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
    return { ok: false, message: "Enter a valid base URL." };
  }
  if (!apiKey) return { ok: false, message: "Enter the API key." };

  let result: Awaited<ReturnType<typeof upsertConnection>>;
  try {
    result = await upsertConnection(
      { organizationId: session.workspace.organizationId, projectId: null },
      provider,
      baseUrl,
      apiKey,
      session.user.id,
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
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!fixedBaseUrl && !/^https?:\/\/.+/i.test(baseUrl)) {
    return { ok: false, message: "Enter a valid base URL." };
  }
  if (!apiKey) return { ok: false, message: "Enter the API key." };

  let result: Awaited<ReturnType<typeof upsertConnection>>;
  try {
    result = await upsertConnection(
      { organizationId: session.workspace.organizationId, projectId: project.id },
      provider,
      baseUrl,
      apiKey,
      session.user.id,
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
