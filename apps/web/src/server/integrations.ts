import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, decryptCredential, resolveAiCredentials, schema } from "@falorb/db";
import { LinkiClient } from "@falorb/linki-client";
import { BundAiClient } from "@falorb/bund-ai-client";
import { BufferClient } from "@falorb/buffer-client";
import { ExaClient, FirecrawlClient, type ResearchClients } from "@falorb/research";
import { ElevenLabsClient } from "@falorb/elevenlabs-client";
import { OpenSeoClient } from "@falorb/openseo-client";
import type { AiCredentials, AiProvider } from "@falorb/ai";

/**
 * Builds a typed client from a stored `integrationConnections` row, for
 * server actions that take a real action on Linki/Bund AI/Buffer (not just
 * reading the mirror) or research on Exa/Firecrawl's behalf. Returns null
 * when neither the project nor the org has connected, or the connection has
 * revoked/errored — callers turn that into "connect it in Settings" rather
 * than a stack trace. Clay has no equivalent getter here — nothing in the web
 * app calls Clay directly; only `apps/worker/src/jobs/clay-enrichment.ts`
 * does, and it builds its own client from the connection row (org-level only
 * — see that job's own query).
 */

/**
 * A project's own connection for this provider, if it has one, else the
 * org's — the override-with-fallback behaviour described in FEATURES.md
 * §13: a property with its own Buffer/Exa/etc. account uses that one, a
 * property with none uses whatever the organization has connected.
 * `projectId` omitted (org-only call sites — Linki/Bund AI have none today)
 * goes straight to the org-level row.
 */
async function activeConnection(
  organizationId: string,
  provider: "linki" | "bund_ai" | "buffer" | "exa" | "firecrawl" | "elevenlabs" | "openseo",
  projectId?: number,
) {
  if (projectId != null) {
    const [projectRow] = await db()
      .select()
      .from(schema.integrationConnections)
      .where(
        and(
          eq(schema.integrationConnections.organizationId, organizationId),
          eq(schema.integrationConnections.projectId, projectId),
          eq(schema.integrationConnections.provider, provider),
          eq(schema.integrationConnections.status, "active"),
        ),
      )
      .limit(1);
    if (projectRow) return projectRow;
  }

  const [orgRow] = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
        eq(schema.integrationConnections.provider, provider),
        eq(schema.integrationConnections.status, "active"),
      ),
    )
    .limit(1);
  return orgRow ?? null;
}

export async function getLinkiClient(organizationId: string, projectId?: number): Promise<LinkiClient | null> {
  const row = await activeConnection(organizationId, "linki", projectId);
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new LinkiClient({ baseUrl: row.baseUrl, apiKey });
}

export async function getBundAiClient(organizationId: string, projectId?: number): Promise<BundAiClient | null> {
  const row = await activeConnection(organizationId, "bund_ai", projectId);
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new BundAiClient({ baseUrl: row.baseUrl, apiKey });
}

/**
 * A project's own OpenSEO connection if it has one, else the org's — used
 * both when drafting a content page (`@/server/content-draft`) and by the
 * per-project SEO monitoring page (`@/server/seo`). Project-scoped like
 * `getLinkiClient`, not org-only like `getElevenLabsClient`: OpenSEO's data
 * (rank tracking, domain keywords) is inherently about one property's own
 * domain, not the organization as a whole.
 */
export async function getOpenSeoClient(organizationId: string, projectId?: number): Promise<OpenSeoClient | null> {
  const row = await activeConnection(organizationId, "openseo", projectId);
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new OpenSeoClient({ baseUrl: row.baseUrl, apiKey });
}

export async function getBufferClient(organizationId: string, projectId?: number): Promise<BufferClient | null> {
  const row = await activeConnection(organizationId, "buffer", projectId);
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new BufferClient({ baseUrl: row.baseUrl, apiKey });
}

/**
 * The org's ElevenLabs connection, for the UGC composer's voice picker
 * (`/ugc-videos`). Org-level only — no `projectId` argument, matching the
 * table this serves: a UGC video's `projectId` is a tag, and the account
 * whose voices and billing are used is the organization's.
 *
 * Unlike the getters above, this one has a *read* caller in the web app.
 * `apps/worker/src/jobs/ugc-video-gen.ts` still builds its own client from
 * the connection row, because it sweeps every connected org rather than
 * resolving one.
 */
export async function getElevenLabsClient(organizationId: string): Promise<ElevenLabsClient | null> {
  const row = await activeConnection(organizationId, "elevenlabs");
  if (!row) return null;
  const apiKey = decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag });
  return new ElevenLabsClient({ baseUrl: row.baseUrl, apiKey });
}

/**
 * Builds `@falorb/research`'s `ResearchClients` bag from whichever of
 * Exa/Firecrawl this organization (or, when `projectId` is given, this
 * project — falling back to the org) has connected — either, both, or
 * neither. `search`/`fetchPage` (`@falorb/research`) treat a `null` entry as
 * "no connection" and fall back to the other provider, so this never throws
 * for an org/project that hasn't connected one or either.
 */
export async function getResearchClients(organizationId: string, projectId?: number): Promise<ResearchClients> {
  const [exaRow, firecrawlRow] = await Promise.all([
    activeConnection(organizationId, "exa", projectId),
    activeConnection(organizationId, "firecrawl", projectId),
  ]);

  return {
    exa: exaRow
      ? new ExaClient({
          baseUrl: exaRow.baseUrl,
          apiKey: decryptCredential({ ciphertext: exaRow.encryptedApiKey, iv: exaRow.iv, authTag: exaRow.authTag }),
        })
      : null,
    firecrawl: firecrawlRow
      ? new FirecrawlClient({
          baseUrl: firecrawlRow.baseUrl,
          apiKey: decryptCredential({
            ciphertext: firecrawlRow.encryptedApiKey,
            iv: firecrawlRow.iv,
            authTag: firecrawlRow.authTag,
          }),
        })
      : null,
  };
}

/**
 * Which AI gateway, on whose key and which model, this organization's AI
 * features should run on — the web app's door onto `resolveAiCredentials`
 * (`@falorb/db`), which the worker and MCP server come through too. Kept
 * behind `src/server` like every other secret-reading helper in this file
 * rather than imported directly at each call site.
 *
 * The result goes straight into `complete()`/`chat()`/`generateSignal()`,
 * including when it is null: those fall back to the deployment-wide
 * `OPENROUTER_API_KEY` on a null, which is what every caller did before
 * organizations could bring their own.
 */
export async function getAiCredentials(
  organizationId: string,
  projectId?: number | null,
): Promise<AiCredentials | null> {
  return resolveAiCredentials(db(), organizationId, projectId);
}

export type Provider =
  | "linki"
  | "bund_ai"
  | "buffer"
  | "postiz"
  | "clay"
  | "exa"
  | "firecrawl"
  | "elevenlabs"
  | "openseo"
  | AiProvider;

export const PROVIDERS: Provider[] = [
  "openrouter",
  "router",
  "gemini",
  "linki",
  "bund_ai",
  "buffer",
  "postiz",
  "clay",
  "exa",
  "firecrawl",
  "elevenlabs",
  "openseo",
];

export interface ConnectionView {
  provider: Provider;
  baseUrl: string;
  /** The chosen model, for the AI gateways; null for every other provider,
   * and for a gateway left on its default. Not a secret — shown in the UI. */
  model: string | null;
  status: "active" | "revoked" | "error";
  lastVerifiedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

function toConnectionView(r: typeof schema.integrationConnections.$inferSelect): ConnectionView {
  return {
    provider: r.provider,
    baseUrl: r.baseUrl,
    model: r.model,
    status: r.status,
    lastVerifiedAt: r.lastVerifiedAt?.toISOString() ?? null,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastError: r.lastError,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * For the org Settings → Integrations page. Org-level rows only
 * (`projectId is null`) — a project's own overrides are managed on that
 * project's settings page instead, via `listProjectConnections`. Never
 * returns key material — there is nothing here safe to display.
 */
export async function listConnections(organizationId: string): Promise<ConnectionView[]> {
  const rows = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        isNull(schema.integrationConnections.projectId),
      ),
    );

  return rows.map(toConnectionView);
}

export interface ProjectConnectionView {
  provider: Provider;
  /** This project's own connection for the provider, if it has one. */
  override: ConnectionView | null;
  /** The organization's connection, used when `override` is null. */
  inherited: ConnectionView | null;
}

/**
 * For a property's Settings → Integrations panel: every provider, showing
 * whether the property has its own override and what it would otherwise
 * inherit from the organization. Never returns key material.
 */
export async function listProjectConnections(
  organizationId: string,
  projectId: number,
): Promise<ProjectConnectionView[]> {
  const rows = await db()
    .select()
    .from(schema.integrationConnections)
    .where(
      and(
        eq(schema.integrationConnections.organizationId, organizationId),
        or(eq(schema.integrationConnections.projectId, projectId), isNull(schema.integrationConnections.projectId)),
      ),
    );

  const overrides = new Map(rows.filter((r) => r.projectId === projectId).map((r) => [r.provider, toConnectionView(r)]));
  const inherited = new Map(rows.filter((r) => r.projectId === null).map((r) => [r.provider, toConnectionView(r)]));

  return PROVIDERS.map((provider) => ({
    provider,
    override: overrides.get(provider) ?? null,
    inherited: inherited.get(provider) ?? null,
  }));
}
