import { and, eq, inArray } from "drizzle-orm";
import { AI_PROVIDERS, AI_PROVIDER_DEFAULT_MODELS, isAiProvider, envCredentials, type AiCredentials } from "@falorb/ai";
import type { Database } from "./index";
import { decryptCredential } from "./crypto";
import * as schema from "./schema/index";

/**
 * Which AI provider an organization's AI features run on, on whose key, and
 * with which model — the read side of "bring your own model" (FEATURES.md
 * §19).
 *
 * Lives here rather than in one app because all three need it and none of
 * them owns it: the dashboard resolves it per server action, the worker per
 * job, and the MCP server per tool call. It reads an
 * `integration_connections` row and decrypts its key, which is this
 * package's job already (`crypto.ts`), and returns the credential shape
 * `@falorb/ai` takes — the one place those two meet.
 *
 * Returns null only when the organization has connected no provider *and*
 * the deployment has no `OPENROUTER_API_KEY`; callers turn that into
 * "AI is not configured" the same way they always have. Passing the result
 * straight into `complete()`/`chat()`/`generateSignal()` is safe either
 * way: they fall back to the environment on a null.
 *
 * Precedence:
 *
 *   1. a connection this property owns, if it has one — the same
 *      override-with-fallback rule every other provider follows;
 *   2. otherwise the organization's;
 *   3. otherwise the deployment-wide `OPENROUTER_API_KEY`.
 *
 * More than one provider can be connected at once (an org trying Gemini
 * while keeping its OpenRouter key), so within one scope the most recently
 * updated active connection wins — connecting or reconnecting one is what
 * switches to it. Settings → Integrations marks which is in use rather than
 * leaving that implicit.
 */
export async function resolveAiCredentials(
  database: Database,
  organizationId: string,
  projectId?: number | null,
): Promise<AiCredentials | null> {
  const rows = await database
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        eq(schema.integrationConnections.status, "active"),
        // Driven off `AI_PROVIDERS` rather than a hand-written list of
        // `eq(...)`s, so adding a provider to `@falorb/ai` cannot leave this
        // query silently skipping it — the failure mode there is an org
        // whose connected gateway is ignored in favour of the deployment
        // key, which reads as a billing mystery rather than a bug.
        inArray(schema.integrationConnections.provider, AI_PROVIDERS),
      ),
    );

  const scoped = projectId != null ? rows.filter((r) => r.projectId === projectId) : [];
  const candidates = (scoped.length ? scoped : rows.filter((r) => r.projectId === null)).sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  const row = candidates[0];
  if (!row || !isAiProvider(row.provider)) return envCredentials();

  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    apiKey: decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag }),
    model: row.model?.trim() || AI_PROVIDER_DEFAULT_MODELS[row.provider],
  };
}
