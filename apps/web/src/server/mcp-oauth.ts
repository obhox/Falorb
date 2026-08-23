import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, decryptOAuthState, encryptCredential, decryptCredential, schema, type EncryptedCredential } from "@falorb/db";
import type { OAuthClientInformationFull, OAuthProviderState } from "@falorb/mcp-connector";

/**
 * Shared helpers for the "connect an MCP server via OAuth" flow, used by
 * both `startMcpOAuthConnect` (`server/actions/mcp-servers.ts`) and the
 * callback route (`app/(app)/settings/integrations/mcp/oauth/callback`) —
 * split out because both legs need to encrypt/decrypt the same in-flight
 * `mcp_oauth_attempts` row shape, and a connect attempt should reuse a
 * previously-registered OAuth client rather than re-register with the
 * external server on every retry.
 */

/** How long a connect attempt survives an abandoned or slow redirect before it's just an inert row. */
export const MCP_OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export function mcpOAuthCallbackUrl(): string {
  const base = process.env.FALORB_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/settings/integrations/mcp/oauth/callback`;
}

/** `mcp_oauth_attempts.encryptedState` never holds tokens — only what's needed to resume after the redirect. */
export function encryptAttemptState(state: OAuthProviderState): EncryptedCredential {
  return encryptCredential(JSON.stringify(state));
}

export function decryptAttemptState(encrypted: EncryptedCredential): OAuthProviderState {
  return JSON.parse(decryptCredential(encrypted)) as OAuthProviderState;
}

/**
 * The OAuth client this organization already registered with this server
 * name last time, if any — reusing it means a reconnect (expired refresh
 * token, retried attempt) skips RFC 7591 dynamic client registration
 * instead of registering a fresh client with the external server every
 * time. Scoped strictly to this organization; never shared across tenants
 * even when they connect to the same external server.
 */
export async function seedClientInformation(
  organizationId: string,
  name: string,
): Promise<OAuthClientInformationFull | undefined> {
  const [row] = await db()
    .select({
      encryptedOAuth: schema.mcpConnections.encryptedOAuth,
      oauthIv: schema.mcpConnections.oauthIv,
      oauthAuthTag: schema.mcpConnections.oauthAuthTag,
    })
    .from(schema.mcpConnections)
    .where(and(eq(schema.mcpConnections.organizationId, organizationId), eq(schema.mcpConnections.name, name)))
    .orderBy(desc(schema.mcpConnections.updatedAt))
    .limit(1);
  if (!row?.encryptedOAuth || !row.oauthIv || !row.oauthAuthTag) return undefined;

  try {
    const state = decryptOAuthState({ ciphertext: row.encryptedOAuth, iv: row.oauthIv, authTag: row.oauthAuthTag });
    return state.clientInformation;
  } catch {
    // A previous encryption key rotation, corruption, or any other
    // decrypt failure just means "register fresh" — this is an
    // optimization, never load-bearing for correctness.
    return undefined;
  }
}
