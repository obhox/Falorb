import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import {
  AUDIT_ACTIONS,
  audit,
  decryptCredential,
  encryptCredential,
  schema,
  type Database,
} from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { ClayClient, CLAY_DEFAULT_BASE_URL } from "@falorb/clay-client";
import { ExaClient, EXA_DEFAULT_BASE_URL, FirecrawlClient, FIRECRAWL_DEFAULT_BASE_URL } from "@falorb/research";
import { ElevenLabsClient, ELEVENLABS_DEFAULT_BASE_URL } from "@falorb/elevenlabs-client";
import type { Workspace } from "../onboarding";
import { HttpError } from "../http";
import { requireHumanSession } from "../guards";

/**
 * Connection management for the external products Falorb drives on the
 * organization's behalf (Linki, Bund AI, Clay, Exa, Firecrawl, ElevenLabs,
 * more over time).
 *
 * Deliberately human-session-only end to end, not scope-gated for API keys —
 * same reasoning as `POST /api/keys` in `index.ts`: storing, testing, or
 * revoking a credential that lets Falorb act as another product's tenant is
 * exactly the class of act a leaked bearer key must not be able to do, since
 * revoking the leaked key would not undo what it already connected.
 *
 * `verifyConnection` delegates to each product's real typed client
 * (`packages/linki-client`, `packages/bund-ai-client`, `packages/clay-client`,
 * `packages/research`) rather than a generic raw `fetch` — one
 * implementation of "how do I reach this API" per product, shared with the
 * mirror/enrichment jobs (`linki-sync.ts`, `bund-ai-sync.ts`,
 * `clay-enrichment.ts`) instead of a second one living only here.
 */

type Vars = {
  userId: string | null;
  workspace: Workspace | null;
  scopes: string[];
};

/**
 * `fixedBaseUrl: null` means the provider is a self-hosted deployment (like
 * Linki/Bund AI) and the caller must supply a `baseUrl`. A non-null value
 * means the provider has one API root (Clay, Exa, Firecrawl) — callers
 * don't supply a baseUrl for it; the fixed value here is used instead.
 */
const PROVIDERS = {
  linki: { label: "Linki", fixedBaseUrl: null },
  bund_ai: { label: "Bund AI", fixedBaseUrl: null },
  clay: { label: "Clay", fixedBaseUrl: CLAY_DEFAULT_BASE_URL },
  exa: { label: "Exa", fixedBaseUrl: EXA_DEFAULT_BASE_URL },
  firecrawl: { label: "Firecrawl", fixedBaseUrl: FIRECRAWL_DEFAULT_BASE_URL },
  elevenlabs: { label: "ElevenLabs", fixedBaseUrl: ELEVENLABS_DEFAULT_BASE_URL },
} as const satisfies Record<string, { label: string; fixedBaseUrl: string | null }>;

type Provider = keyof typeof PROVIDERS;

function parseProvider(raw: string): Provider {
  if (raw in PROVIDERS) return raw as Provider;
  throw new HttpError(404, `Unknown integration provider "${raw}".`);
}

async function pingProvider(
  provider: Provider,
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; detail: string }> {
  const client =
    provider === "linki"
      ? new LinkiClient({ baseUrl, apiKey })
      : provider === "bund_ai"
        ? new BundAiClient({ baseUrl, apiKey })
        : provider === "clay"
          ? new ClayClient({ baseUrl, apiKey })
          : provider === "exa"
            ? new ExaClient({ baseUrl, apiKey })
            : provider === "firecrawl"
              ? new FirecrawlClient({ baseUrl, apiKey })
              : new ElevenLabsClient({ baseUrl, apiKey });
  return client.verifyConnection();
}

function publicConnection(row: typeof schema.integrationConnections.$inferSelect) {
  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Deliberately no key material, not even the prefix — unlike `api_keys`,
    // there is nothing here safe to display; the whole value is a live
    // credential for a third party, not a Falorb-issued token.
  };
}

export function integrationsRoutes(db: Database): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/connections", async (c) => {
    const workspace = requireHumanSession(c, "view connected integrations");
    const rows = await db
      .select()
      .from(schema.integrationConnections)
      .where(eq(schema.integrationConnections.organizationId, workspace.organizationId));
    return c.json({ connections: rows.map(publicConnection) });
  });

  const connectSchema = z.object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1),
  });

  app.post("/:provider/connection", async (c) => {
    const workspace = requireHumanSession(c, "connect an integration");
    const provider = parseProvider(c.req.param("provider"));

    const parsed = connectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(422, "apiKey is required.");
    const fixedBaseUrl = PROVIDERS[provider].fixedBaseUrl;
    if (!fixedBaseUrl && !parsed.data.baseUrl) {
      throw new HttpError(422, "baseUrl is required.");
    }
    const baseUrl = fixedBaseUrl ?? parsed.data.baseUrl!;

    const check = await pingProvider(provider, baseUrl, parsed.data.apiKey);
    const encrypted = encryptCredential(parsed.data.apiKey);

    const [row] = await db
      .insert(schema.integrationConnections)
      .values({
        organizationId: workspace.organizationId,
        provider,
        baseUrl,
        encryptedApiKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        status: check.ok ? "active" : "error",
        lastVerifiedAt: check.ok ? new Date() : null,
        lastError: check.ok ? null : check.detail,
        createdBy: c.get("userId"),
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

    audit(db, {
      organizationId: workspace.organizationId,
      actorId: c.get("userId"),
      action: AUDIT_ACTIONS.integrationConnected,
      targetType: "integration_connection",
      targetId: row!.id,
      metadata: { provider, baseUrl, verified: check.ok },
    });

    return c.json(
      { connection: publicConnection(row!), verification: check },
      check.ok ? 201 : 202,
    );
  });

  app.post("/:provider/connection/test", async (c) => {
    const workspace = requireHumanSession(c, "test an integration connection");
    const provider = parseProvider(c.req.param("provider"));

    const [row] = await db
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.organizationId, workspace.organizationId),
          eq(schema.integrationConnections.provider, provider),
        ),
      )
      .limit(1);

    if (!row) throw new HttpError(404, `No ${PROVIDERS[provider].label} connection to test.`);
    if (row.status === "revoked") throw new HttpError(409, "This connection has been revoked.");

    const apiKey = decryptCredential({
      ciphertext: row.encryptedApiKey,
      iv: row.iv,
      authTag: row.authTag,
    });
    const check = await pingProvider(provider, row.baseUrl, apiKey);

    await db
      .update(schema.integrationConnections)
      .set({
        status: check.ok ? "active" : "error",
        lastVerifiedAt: check.ok ? new Date() : row.lastVerifiedAt,
        lastError: check.ok ? null : check.detail,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrationConnections.id, row.id));

    return c.json({ verification: check });
  });

  app.delete("/:provider/connection", async (c) => {
    const workspace = requireHumanSession(c, "revoke an integration connection");
    const provider = parseProvider(c.req.param("provider"));

    const [revoked] = await db
      .update(schema.integrationConnections)
      .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrationConnections.organizationId, workspace.organizationId),
          eq(schema.integrationConnections.provider, provider),
        ),
      )
      .returning();

    if (!revoked) throw new HttpError(404, `No ${PROVIDERS[provider].label} connection to revoke.`);

    audit(db, {
      organizationId: workspace.organizationId,
      actorId: c.get("userId"),
      action: AUDIT_ACTIONS.integrationRevoked,
      targetType: "integration_connection",
      targetId: revoked.id,
      metadata: { provider },
    });

    return c.json({ revoked: true, provider });
  });

  return app;
}
