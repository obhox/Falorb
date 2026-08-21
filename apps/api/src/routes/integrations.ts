import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import { BufferClient, BUFFER_API_ENDPOINT } from "@falorb/buffer-client";
import { ClayClient, CLAY_DEFAULT_BASE_URL } from "@falorb/clay-client";
import { ExaClient, EXA_DEFAULT_BASE_URL, FirecrawlClient, FIRECRAWL_DEFAULT_BASE_URL } from "@falorb/research";
import { ElevenLabsClient, ELEVENLABS_DEFAULT_BASE_URL } from "@falorb/elevenlabs-client";
import type { Workspace } from "../onboarding";
import { HttpError } from "../http";
import { requireHumanSession } from "../guards";

/**
 * Connection management for the external products Falorb drives on the
 * organization's behalf (Linki, Bund AI, Buffer, Clay, Exa, Firecrawl,
 * ElevenLabs, more over time) — org-level by default, or scoped to one
 * property (`?project=<slug>`) to store an override for that property alone.
 * A property with its own connection for a provider uses that one; a
 * property with none falls back to the organization's. See
 * `packages/db/src/schema/integrations.ts` for the two-partial-index shape
 * this rests on, and `apps/web/src/server/integrations.ts`'s
 * `activeConnection` for the read-side fallback.
 *
 * Deliberately human-session-only end to end, not scope-gated for API keys —
 * same reasoning as `POST /api/keys` in `index.ts`: storing, testing, or
 * revoking a credential that lets Falorb act as another product's tenant is
 * exactly the class of act a leaked bearer key must not be able to do, since
 * revoking the leaked key would not undo what it already connected.
 *
 * `verifyConnection` delegates to each product's real typed client
 * (`packages/linki-client`, `packages/bund-ai-client`, `packages/buffer-client`,
 * `packages/clay-client`, `packages/research`, `packages/elevenlabs-client`)
 * rather than a generic raw `fetch` — one implementation of "how do I reach
 * this API" per product, shared with the mirror/enrichment jobs
 * (`linki-sync.ts`, `bund-ai-sync.ts`, `buffer-sync.ts`,
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
  buffer: { label: "Buffer", fixedBaseUrl: BUFFER_API_ENDPOINT },
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
  if (provider === "linki") return new LinkiClient({ baseUrl, apiKey }).verifyConnection();
  if (provider === "bund_ai") return new BundAiClient({ baseUrl, apiKey }).verifyConnection();
  if (provider === "buffer") return new BufferClient({ baseUrl, apiKey }).verifyConnection();
  if (provider === "clay") return new ClayClient({ baseUrl, apiKey }).verifyConnection();
  if (provider === "exa") return new ExaClient({ baseUrl, apiKey }).verifyConnection();
  if (provider === "firecrawl") return new FirecrawlClient({ baseUrl, apiKey }).verifyConnection();
  return new ElevenLabsClient({ baseUrl, apiKey }).verifyConnection();
}

function publicConnection(row: typeof schema.integrationConnections.$inferSelect) {
  return {
    provider: row.provider,
    projectId: row.projectId,
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

/**
 * Resolves the optional `?project=<slug>` query param to a project id scoped
 * to the caller's own organization — same pattern `POST /api/keys` in
 * `index.ts` uses for its body `project` field. `null` (no query param) means
 * "the organization's own connection," not "any project."
 */
async function resolveProjectId(db: Database, organizationId: string, slug: string | undefined): Promise<number | null> {
  if (!slug) return null;
  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.slug, slug), eq(schema.projects.organizationId, organizationId)))
    .limit(1);
  if (!project) throw new HttpError(404, `No project "${slug}".`);
  return project.id;
}

export function integrationsRoutes(db: Database): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/connections", async (c) => {
    const workspace = requireHumanSession(c, "view connected integrations");
    const projectId = await resolveProjectId(db, workspace.organizationId, c.req.query("project"));
    const rows = await db
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.organizationId, workspace.organizationId),
          projectId === null
            ? isNull(schema.integrationConnections.projectId)
            : eq(schema.integrationConnections.projectId, projectId),
        ),
      );
    return c.json({ connections: rows.map(publicConnection) });
  });

  const connectSchema = z.object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1),
  });

  app.post("/:provider/connection", async (c) => {
    const workspace = requireHumanSession(c, "connect an integration");
    const provider = parseProvider(c.req.param("provider"));
    const projectId = await resolveProjectId(db, workspace.organizationId, c.req.query("project"));

    const parsed = connectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(422, "apiKey is required.");
    const fixedBaseUrl = PROVIDERS[provider].fixedBaseUrl;
    if (!fixedBaseUrl && !parsed.data.baseUrl) {
      throw new HttpError(422, "baseUrl is required.");
    }
    const baseUrl = fixedBaseUrl ?? parsed.data.baseUrl!;

    let check: { ok: boolean; detail: string };
    let encrypted: ReturnType<typeof encryptCredential>;
    try {
      check = await pingProvider(provider, baseUrl, parsed.data.apiKey);
      encrypted = encryptCredential(parsed.data.apiKey);
    } catch (error) {
      // pingProvider's own client always catches its network errors and
      // returns { ok: false }, so a throw here is almost always
      // encryptCredential() rejecting a missing/malformed
      // INTEGRATION_CREDENTIAL_ENC_KEY — an operator misconfiguration, not a
      // caller error, but still one the caller should see plainly.
      throw new HttpError(500, error instanceof Error ? error.message : "Could not connect this integration.");
    }

    // Which of the two partial unique indexes on `integration_connections`
    // (`packages/db/src/schema/integrations.ts`) is the upsert's conflict
    // target depends on scope — `targetWhere` has to match it, or Postgres
    // rejects the insert with "no unique or exclusion constraint matching
    // the ON CONFLICT specification".
    const conflict =
      projectId === null
        ? {
            target: [schema.integrationConnections.organizationId, schema.integrationConnections.provider],
            targetWhere: sql`${schema.integrationConnections.projectId} is null`,
          }
        : {
            target: [
              schema.integrationConnections.organizationId,
              schema.integrationConnections.projectId,
              schema.integrationConnections.provider,
            ],
            targetWhere: sql`${schema.integrationConnections.projectId} is not null`,
          };

    const [row] = await db
      .insert(schema.integrationConnections)
      .values({
        organizationId: workspace.organizationId,
        projectId,
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
        ...conflict,
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
      metadata: { provider, baseUrl, verified: check.ok, projectId },
    });

    return c.json(
      { connection: publicConnection(row!), verification: check },
      check.ok ? 201 : 202,
    );
  });

  app.post("/:provider/connection/test", async (c) => {
    const workspace = requireHumanSession(c, "test an integration connection");
    const provider = parseProvider(c.req.param("provider"));
    const projectId = await resolveProjectId(db, workspace.organizationId, c.req.query("project"));

    const [row] = await db
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.organizationId, workspace.organizationId),
          projectId === null
            ? isNull(schema.integrationConnections.projectId)
            : eq(schema.integrationConnections.projectId, projectId),
          eq(schema.integrationConnections.provider, provider),
        ),
      )
      .limit(1);

    if (!row) throw new HttpError(404, `No ${PROVIDERS[provider].label} connection to test.`);
    if (row.status === "revoked") throw new HttpError(409, "This connection has been revoked.");

    let check: { ok: boolean; detail: string };
    try {
      const apiKey = decryptCredential({
        ciphertext: row.encryptedApiKey,
        iv: row.iv,
        authTag: row.authTag,
      });
      check = await pingProvider(provider, row.baseUrl, apiKey);
    } catch (error) {
      throw new HttpError(
        500,
        error instanceof Error ? error.message : `Could not test the ${PROVIDERS[provider].label} connection.`,
      );
    }

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
    const projectId = await resolveProjectId(db, workspace.organizationId, c.req.query("project"));

    const [revoked] = await db
      .update(schema.integrationConnections)
      .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrationConnections.organizationId, workspace.organizationId),
          projectId === null
            ? isNull(schema.integrationConnections.projectId)
            : eq(schema.integrationConnections.projectId, projectId),
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
      metadata: { provider, projectId },
    });

    return c.json({ revoked: true, provider });
  });

  return app;
}
