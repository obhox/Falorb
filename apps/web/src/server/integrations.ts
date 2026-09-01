import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, decryptCredential, resolveAiCredentials, schema } from "@falorb/db";
import { FirecrawlClient, type ResearchClients } from "@falorb/research";
import type { AiCredentials, AiProvider } from "@falorb/ai";

/**
 * Builds a typed client from a stored `integrationConnections` row, for
 * server actions that research on Firecrawl's behalf. Returns null when
 * neither the project nor the org has connected, or the connection has
 * revoked/errored — callers turn that into "connect it in Settings" rather
 * than a stack trace.
 */

/**
 * A project's own connection for this provider, if it has one, else the
 * org's — the override-with-fallback behaviour described in FEATURES.md
 * §13: a property with its own Firecrawl account uses that one, a property
 * with none uses whatever the organization has connected. `projectId`
 * omitted goes straight to the org-level row.
 */
async function activeConnection(
  organizationId: string,
  provider: "firecrawl",
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

/**
 * Builds `@falorb/research`'s `ResearchClients` bag from this organization's
 * (or, when `projectId` is given, this project's — falling back to the org)
 * Firecrawl connection. `search`/`fetchPage` (`@falorb/research`) treat a
 * `null` entry as "no connection" and raise `ResearchUnavailableError`, so
 * this never throws for an org/project that hasn't connected it.
 */
export async function getResearchClients(organizationId: string, projectId?: number): Promise<ResearchClients> {
  const row = await activeConnection(organizationId, "firecrawl", projectId);

  return {
    firecrawl: row
      ? new FirecrawlClient({
          baseUrl: row.baseUrl,
          apiKey: decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag }),
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

export type Provider = "firecrawl" | AiProvider;

export const PROVIDERS: Provider[] = ["openrouter", "router", "gemini", "firecrawl"];

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

  const overrides = new Map(
    rows.filter((r) => r.projectId === projectId).map((r) => [r.provider, toConnectionView(r)]),
  );
  const inherited = new Map(
    rows.filter((r) => r.projectId === null).map((r) => [r.provider, toConnectionView(r)]),
  );

  return PROVIDERS.map((provider) => ({
    provider,
    override: overrides.get(provider) ?? null,
    inherited: inherited.get(provider) ?? null,
  }));
}
