import { NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, encryptOAuthState, schema } from "@falorb/db";
import { McpConnectorClient, StatefulOAuthProvider, auth } from "@falorb/mcp-connector";
import { requireSession } from "@/server/session";
import { decryptAttemptState, mcpOAuthCallbackUrl } from "@/server/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the external authorization server sends the user's browser back to,
 * after `startMcpOAuthConnect` (`server/actions/mcp-servers.ts`) redirected
 * them out. Finishes the connect: exchanges the code for tokens, verifies
 * the connection, and upserts the `mcpConnections` row — the same shape
 * `connectMcpServer` writes for the API-key path, just reached from a GET
 * instead of a form post since there is no other way back from a redirect.
 *
 * The attempt row is deleted atomically as part of looking it up — the
 * `state` query param *is* this flow's entire CSRF defense (the MCP SDK's
 * `auth()` never checks `state` itself, confirmed by reading its
 * implementation), and matching it against both `id` and the caller's own
 * `organizationId` in one `DELETE ... RETURNING` closes the read-then-delete
 * race a separate select-then-delete would leave open on a double-hit
 * callback.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  const url = new URL(request.url);
  // Not `url.origin` — behind a reverse proxy (Coolify, etc.) `request.url`
  // reflects the internal request the proxy forwarded, which can carry a
  // container-local host like `localhost:3000` instead of the public
  // origin. `FALORB_APP_URL` is the one already-correct source for that
  // (same one `mcpOAuthCallbackUrl()` used to build the redirect_uri this
  // callback was actually reached through), and every other absolute link
  // in this app already redirects through it rather than `request.url`.
  const settingsUrl = new URL("/settings/integrations", process.env.FALORB_APP_URL ?? "http://localhost:3000");

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  const [attempt] = state
    ? await db()
        .delete(schema.mcpOAuthAttempts)
        .where(
          and(
            eq(schema.mcpOAuthAttempts.id, state),
            eq(schema.mcpOAuthAttempts.organizationId, session.workspace.organizationId),
            gt(schema.mcpOAuthAttempts.expiresAt, sql`now()`),
          ),
        )
        .returning()
    : [];

  if (oauthError) {
    settingsUrl.searchParams.set("mcpOAuth", "error");
    settingsUrl.searchParams.set(
      "mcpOAuthMessage",
      url.searchParams.get("error_description") ?? `Authorization was declined (${oauthError}).`,
    );
    return NextResponse.redirect(settingsUrl);
  }

  if (!attempt || !code) {
    settingsUrl.searchParams.set("mcpOAuth", "error");
    settingsUrl.searchParams.set("mcpOAuthMessage", "This sign-in link has expired or was already used — try connecting again.");
    return NextResponse.redirect(settingsUrl);
  }

  const seedState = decryptAttemptState({
    ciphertext: attempt.encryptedState,
    iv: attempt.stateIv,
    authTag: attempt.stateAuthTag,
  });

  const provider = new StatefulOAuthProvider({
    redirectUrl: mcpOAuthCallbackUrl(),
    state: attempt.id,
    initial: seedState,
  });

  try {
    const result = await auth(provider, { serverUrl: attempt.url, authorizationCode: code });
    const tokens = provider.tokens();
    const discoveryState = provider.discoveryState();
    const clientInformation = provider.clientInformation();
    if (result !== "AUTHORIZED" || !tokens || !clientInformation || !discoveryState) {
      throw new Error("The server didn't return an access token.");
    }

    const client = new McpConnectorClient({ url: attempt.url, apiKey: tokens.access_token });
    const check = await client.verifyConnection();

    const encrypted = encryptOAuthState({
      tokens: { ...tokens, obtainedAt: Date.now() },
      clientInformation,
      authorizationServerUrl: discoveryState.authorizationServerUrl,
      authorizationServerMetadata: discoveryState.authorizationServerMetadata,
    });

    const [row] = await db()
      .insert(schema.mcpConnections)
      .values({
        organizationId: attempt.organizationId,
        name: attempt.name,
        url: attempt.url,
        authMode: "oauth",
        encryptedOAuth: encrypted.ciphertext,
        oauthIv: encrypted.iv,
        oauthAuthTag: encrypted.authTag,
        status: check.ok ? "active" : "error",
        lastVerifiedAt: check.ok ? new Date() : null,
        lastError: check.ok ? null : check.detail,
        toolsCache: check.tools ?? null,
        toolsCachedAt: check.ok ? new Date() : null,
        createdBy: attempt.createdBy,
      })
      .onConflictDoUpdate({
        target: [schema.mcpConnections.organizationId, schema.mcpConnections.name],
        targetWhere: sql`${schema.mcpConnections.revokedAt} is null`,
        set: {
          url: attempt.url,
          authMode: "oauth",
          encryptedApiKey: null,
          iv: null,
          authTag: null,
          encryptedOAuth: encrypted.ciphertext,
          oauthIv: encrypted.iv,
          oauthAuthTag: encrypted.authTag,
          status: check.ok ? "active" : "error",
          lastVerifiedAt: check.ok ? new Date() : null,
          lastError: check.ok ? null : check.detail,
          toolsCache: check.tools ?? null,
          toolsCachedAt: check.ok ? new Date() : null,
          revokedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.mcpConnections.id });

    audit(db(), {
      organizationId: attempt.organizationId,
      actorId: session.user.id,
      action: AUDIT_ACTIONS.integrationConnected,
      targetType: "mcp_connection",
      targetId: row!.id,
      metadata: { name: attempt.name, url: attempt.url },
    });

    settingsUrl.searchParams.set("mcpOAuth", check.ok ? "connected" : "error");
    settingsUrl.searchParams.set(
      "mcpOAuthMessage",
      check.ok ? `"${attempt.name}" connected. ${check.detail}` : `Saved, but couldn't reach it: ${check.detail}`,
    );
  } catch (error) {
    settingsUrl.searchParams.set("mcpOAuth", "error");
    settingsUrl.searchParams.set(
      "mcpOAuthMessage",
      `Couldn't finish connecting "${attempt.name}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return NextResponse.redirect(settingsUrl);
}
