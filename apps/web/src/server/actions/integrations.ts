"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, decryptCredential, encryptCredential, schema } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { ClayClient, CLAY_DEFAULT_BASE_URL } from "@falorb/clay-client";
import { ExaClient, EXA_DEFAULT_BASE_URL, FirecrawlClient, FIRECRAWL_DEFAULT_BASE_URL } from "@falorb/research";
import { ElevenLabsClient, ELEVENLABS_DEFAULT_BASE_URL } from "@falorb/elevenlabs-client";
import { requireSession } from "@/server/session";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Connect, test, or revoke Falorb's connection to Linki, Bund AI, Clay, Exa,
 * Firecrawl, or ElevenLabs.
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

export type Provider = "linki" | "bund_ai" | "clay" | "exa" | "firecrawl" | "elevenlabs";

const LABELS: Record<Provider, string> = {
  linki: "Linki",
  bund_ai: "Bund AI",
  clay: "Clay",
  exa: "Exa",
  firecrawl: "Firecrawl",
  elevenlabs: "ElevenLabs",
};

/**
 * Clay, Exa, Firecrawl, and ElevenLabs each have one fixed API root, unlike
 * Linki/Bund AI's self-hosted deployments — their connect forms carry no
 * baseUrl field at all, so the fixed root is supplied here rather than
 * asked of the user.
 */
const FIXED_BASE_URLS: Partial<Record<Provider, string>> = {
  clay: CLAY_DEFAULT_BASE_URL,
  exa: EXA_DEFAULT_BASE_URL,
  firecrawl: FIRECRAWL_DEFAULT_BASE_URL,
  elevenlabs: ELEVENLABS_DEFAULT_BASE_URL,
};

function clientFor(
  provider: Provider,
  baseUrl: string,
  apiKey: string,
): LinkiClient | BundAiClient | ClayClient | ExaClient | FirecrawlClient | ElevenLabsClient {
  if (provider === "linki") return new LinkiClient({ baseUrl, apiKey });
  if (provider === "bund_ai") return new BundAiClient({ baseUrl, apiKey });
  if (provider === "clay") return new ClayClient({ baseUrl, apiKey });
  if (provider === "exa") return new ExaClient({ baseUrl, apiKey });
  if (provider === "firecrawl") return new FirecrawlClient({ baseUrl, apiKey });
  return new ElevenLabsClient({ baseUrl, apiKey });
}

function isProvider(value: string): value is Provider {
  return (
    value === "linki" ||
    value === "bund_ai" ||
    value === "clay" ||
    value === "exa" ||
    value === "firecrawl" ||
    value === "elevenlabs"
  );
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

  const check = await clientFor(provider, baseUrl, apiKey).verifyConnection();
  const encrypted = encryptCredential(apiKey);
  const orgId = session.workspace.organizationId;

  const [row] = await db()
    .insert(schema.integrationConnections)
    .values({
      organizationId: orgId,
      provider,
      baseUrl,
      encryptedApiKey: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      status: check.ok ? "active" : "error",
      lastVerifiedAt: check.ok ? new Date() : null,
      lastError: check.ok ? null : check.detail,
      createdBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.integrationConnections.organizationId, schema.integrationConnections.provider],
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
    })
    .returning();

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.integrationConnected,
    targetType: "integration_connection",
    targetId: row!.id,
    metadata: { provider, baseUrl, verified: check.ok },
  });

  revalidatePath("/settings/integrations");
  if (!check.ok) return { ok: false, message: `Saved, but ${LABELS[provider]} rejected it: ${check.detail}` };
  return { ok: true, message: `${LABELS[provider]} connected.` };
}

export async function testIntegrationConnection(provider: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `test the ${LABELS[provider]} connection`);
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [row] = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, orgId),
        eq(schema.integrationConnections.provider, provider),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, message: `No ${LABELS[provider]} connection yet.` };
  if (row.status === "revoked") return { ok: false, message: "This connection has been revoked." };

  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  const check = await clientFor(provider, row.baseUrl, apiKey).verifyConnection();

  await db()
    .update(schema.integrationConnections)
    .set({
      status: check.ok ? "active" : "error",
      lastVerifiedAt: check.ok ? new Date() : row.lastVerifiedAt,
      lastError: check.ok ? null : check.detail,
      updatedAt: new Date(),
    })
    .where(eq(schema.integrationConnections.id, row.id));

  revalidatePath("/settings/integrations");
  return check.ok ? { ok: true, message: check.detail } : { ok: false, message: check.detail };
}

export async function revokeIntegrationConnection(provider: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!isProvider(provider)) return { ok: false, message: "Unknown provider." };

  const refusal = deny(session.workspace.role, "manageIntegrations", `revoke the ${LABELS[provider]} connection`);
  if (refusal) return refusal;

  const orgId = session.workspace.organizationId;
  const [revoked] = await db()
    .update(schema.integrationConnections)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.integrationConnections.organizationId, orgId),
        eq(schema.integrationConnections.provider, provider),
      ),
    )
    .returning();
  if (!revoked) return { ok: false, message: `No ${LABELS[provider]} connection to revoke.` };

  audit(db(), {
    organizationId: orgId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.integrationRevoked,
    targetType: "integration_connection",
    targetId: revoked.id,
    metadata: { provider },
  });

  revalidatePath("/settings/integrations");
  return { ok: true, message: `${LABELS[provider]} disconnected.` };
}
