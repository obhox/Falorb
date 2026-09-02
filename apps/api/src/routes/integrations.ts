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
import { assertSafeOutboundUrl, UnsafeUrlError } from "@falorb/core";
import { FirecrawlClient, FIRECRAWL_DEFAULT_BASE_URL } from "@falorb/research";
import type { Workspace } from "../onboarding";
import { HttpError } from "../http";
import { requireCapability, requireHumanSession, type Credential } from "../guards";

/**
 * Connection management for the external products Falorb drives on the
 * organization's behalf (Firecrawl today, more over time) — org-level by
 * default, or scoped to one property (`?project=<slug>`) to store an
 * override for that property alone. A property with its own connection for a
 * provider uses that one; a property with none falls back to the
 * organization's. See `packages/db/src/schema/integrations.ts` for the
 * two-partial-index shape this rests on, and
 * `apps/web/src/server/integrations.ts`'s `activeConnection` for the
 * read-side fallback.
 *
 * Deliberately human-session-only end to end, not scope-gated for API keys —
 * same reasoning as `POST /api/keys` in `index.ts`: storing, testing, or
 * revoking a credential that lets Falorb act as another product's tenant is
 * exactly the class of act a leaked bearer key must not be able to do, since
 * revoking the leaked key would not undo what it already connected.
 *
 * `verifyConnection` delegates to the product's real typed client
 * (`packages/research`) rather than a generic raw `fetch` — one
 * implementation of "how do I reach this API" per product, shared with every
 * caller instead of a second one living only here.
 */

type Vars = {
  userId: string | null;
  workspace: Workspace | null;
  scopes: string[];
  credential: Credential | null;
};

/**
 * Storing, testing or revoking a credential that lets Falorb act as another
 * product's tenant is `manageIntegrations` — admin — in the dashboard's own
 * vocabulary. `requireHumanSession` alone only established that the caller was
 * not a bearer key; it said nothing about whether they were entitled to the
 * act, so a viewer could connect and revoke third-party credentials.
 */
function requireIntegrationAdmin(
  c: {
    get: ((k: "workspace") => Workspace | null) & ((k: "credential") => Credential | null);
  },
  action: string,
): Workspace {
  requireHumanSession(c, action);
  return requireCapability(c, "manageIntegrations", action);
}

/**
 * `fixedBaseUrl: null` means the provider is a self-hosted deployment and
 * the caller must supply a `baseUrl`. A non-null value means the provider
 * has one API root (Firecrawl) — callers don't supply a baseUrl for it; the
 * fixed value here is used instead.
 *
 * A caller-supplied `baseUrl` is a destination this server then connects to,
 * so it goes through the same screen as a webhook target (`resolveBaseUrl`
 * below). `z.string().url()` accepted `http://169.254.169.254/` and
 * `http://redis:6379` alike, and `pingProvider` would dutifully open the
 * connection — with the supplied credential attached, and again on every
 * subsequent sync run. The fixed roots are trusted constants from this
 * repository and are not re-screened.
 */
const PROVIDERS = {
  firecrawl: { label: "Firecrawl", fixedBaseUrl: FIRECRAWL_DEFAULT_BASE_URL },
} as const satisfies Record<string, { label: string; fixedBaseUrl: string | null }>;

type Provider = keyof typeof PROVIDERS;

/**
 * The base URL to use for a provider, screened when it came from the caller.
 *
 * `UnsafeUrlError` is turned into a 422 rather than escaping as a 500: the
 * caller pasted something, and the message explains what was wrong with it.
 */
function resolveBaseUrl(provider: Provider, supplied: string | undefined): string {
  const fixed = PROVIDERS[provider].fixedBaseUrl;
  if (fixed) return fixed;
  if (!supplied) throw new HttpError(422, "baseUrl is required.");
  try {
    return assertSafeOutboundUrl(supplied, `${PROVIDERS[provider].label} deployment`).toString();
  } catch (error) {
    if (error instanceof UnsafeUrlError) throw new HttpError(422, error.message);
    throw error;
  }
}

function parseProvider(raw: string): Provider {
  if (raw in PROVIDERS) return raw as Provider;
  throw new HttpError(404, `Unknown integration provider "${raw}".`);
}

async function pingProvider(
  provider: Provider,
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; detail: string }> {
  if (provider === "firecrawl") return new FirecrawlClient({ baseUrl, apiKey }).verifyConnection();
  throw new HttpError(404, `Unknown integration provider "${provider}".`);
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
    const workspace = requireIntegrationAdmin(c, "view connected integrations");
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
    const workspace = requireIntegrationAdmin(c, "connect an integration");
    const provider = parseProvider(c.req.param("provider"));
    const projectId = await resolveProjectId(db, workspace.organizationId, c.req.query("project"));

    const parsed = connectSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError(422, "apiKey is required.");
    const baseUrl = resolveBaseUrl(provider, parsed.data.baseUrl);
    const credential = parsed.data.apiKey;

    let check: { ok: boolean; detail: string };
    let encrypted: ReturnType<typeof encryptCredential>;
    try {
      check = await pingProvider(provider, baseUrl, credential);
      encrypted = encryptCredential(credential);
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

    return c.json({ connection: publicConnection(row!), verification: check }, check.ok ? 201 : 202);
  });

  app.post("/:provider/connection/test", async (c) => {
    const workspace = requireIntegrationAdmin(c, "test an integration connection");
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

    // Re-screened on the way out, not trusted because it is stored: a row
    // written before this check existed is exactly the one worth doubting, and
    // a hostname's resolution is not fixed anyway. Outside the try below so a
    // refusal keeps its own 422 instead of being flattened into a 500.
    const baseUrl = resolveBaseUrl(provider, row.baseUrl);

    let check: { ok: boolean; detail: string };
    try {
      const apiKey = decryptCredential({
        ciphertext: row.encryptedApiKey,
        iv: row.iv,
        authTag: row.authTag,
      });
      check = await pingProvider(provider, baseUrl, apiKey);
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
    const workspace = requireIntegrationAdmin(c, "revoke an integration connection");
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
