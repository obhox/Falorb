import { eq } from "drizzle-orm";
import { refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Database } from "./index";
import { decryptCredential, encryptCredential, type EncryptedCredential } from "./crypto";
import * as schema from "./schema/index";

/**
 * The OAuth half of a `mcpConnections` row — read/write and, when needed,
 * refresh the credential stored in `encryptedOAuth`/`oauthIv`/`oauthAuthTag`.
 *
 * A deliberate, new dependency: this is the one place `@falorb/db` reaches
 * into `@modelcontextprotocol/sdk` (for `refreshAuthorization`, a pure
 * network+type import — no transport or session state). It lives here
 * rather than in `apps/web` because every consumer of an MCP connection row
 * — the dashboard's own test button, and `@falorb/agents`'s `mcp` toolkit —
 * already depends on `@falorb/db`, and none of them should each reimplement
 * "is this token still good, and if not, refresh and persist it."
 */

export interface McpOAuthState {
  tokens: OAuthTokens & { obtainedAt: number };
  clientInformation: OAuthClientInformationFull;
  authorizationServerUrl: string;
  authorizationServerMetadata?: AuthorizationServerMetadata;
}

export function encryptOAuthState(state: McpOAuthState): EncryptedCredential {
  return encryptCredential(JSON.stringify(state));
}

export function decryptOAuthState(encrypted: EncryptedCredential): McpOAuthState {
  return JSON.parse(decryptCredential(encrypted)) as McpOAuthState;
}

/** However close to expiry still counts as "refresh it now" rather than risking a 401 mid-call. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * A live, unexpired bearer access token for an OAuth-connected MCP server —
 * refreshing and persisting a new one first if the stored one has expired.
 *
 * Proactive only: this checks the stored `expires_in` before use, it does
 * not retry on an unexpected 401 (a server that issues shorter-lived tokens
 * than it declares, or significant clock drift, would still surface as an
 * ordinary connector error rather than being silently recovered — an
 * accepted v1 gap, not a silent failure).
 *
 * A server that never stated `expires_in` is treated as valid indefinitely
 * from here; some legitimately don't expire short-lived access tokens.
 *
 * `resource` (RFC 8707) is re-derived from the connection's own `url` at
 * refresh time rather than round-tripped through storage — the common-case
 * value when no protected-resource metadata narrows it further, and the
 * same one selected when the original authorization ran.
 */
export async function resolveOAuthAccessToken(
  db: Database,
  row: { id: string; url: string; encryptedOAuth: string | null; oauthIv: string | null; oauthAuthTag: string | null },
): Promise<string> {
  if (!row.encryptedOAuth || !row.oauthIv || !row.oauthAuthTag) {
    throw new Error("This connection has no stored OAuth credentials — reconnect it in Settings → Integrations.");
  }

  const state = decryptOAuthState({ ciphertext: row.encryptedOAuth, iv: row.oauthIv, authTag: row.oauthAuthTag });
  const expiresAt = state.tokens.expires_in ? state.tokens.obtainedAt + state.tokens.expires_in * 1000 : Infinity;
  if (Date.now() < expiresAt - EXPIRY_SKEW_MS) return state.tokens.access_token;

  if (!state.tokens.refresh_token) {
    throw new Error(
      "This connection's access token expired and can't be refreshed automatically — reconnect it in Settings → Integrations.",
    );
  }

  const refreshed = await refreshAuthorization(state.authorizationServerUrl, {
    metadata: state.authorizationServerMetadata,
    clientInformation: state.clientInformation,
    refreshToken: state.tokens.refresh_token,
    resource: new URL(row.url),
  });

  const nextState: McpOAuthState = { ...state, tokens: { ...refreshed, obtainedAt: Date.now() } };
  const encrypted = encryptOAuthState(nextState);
  await db
    .update(schema.mcpConnections)
    .set({
      encryptedOAuth: encrypted.ciphertext,
      oauthIv: encrypted.iv,
      oauthAuthTag: encrypted.authTag,
      updatedAt: new Date(),
    })
    .where(eq(schema.mcpConnections.id, row.id));

  return nextState.tokens.access_token;
}
