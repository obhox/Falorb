"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AUDIT_ACTIONS, audit, db, decryptCredential, encryptCredential, resolveOAuthAccessToken, schema } from "@falorb/db";
import { McpConnectorClient, StatefulOAuthProvider, auth } from "@falorb/mcp-connector";
import { requireSession } from "@/server/session";
import {
  MCP_OAUTH_ATTEMPT_TTL_MS,
  encryptAttemptState,
  mcpOAuthCallbackUrl,
  seedClientInformation,
} from "@/server/mcp-oauth";
import type { ActionResult } from "./project";
import { deny } from "./guard";

/**
 * Connect, test, or revoke a remote MCP server — the agent-facing
 * counterpart of `@falorb/agents`'s `mcp` toolkit
 * (`list_mcp_tools`/`call_mcp_tool`), which is what actually calls a
 * connected server's tools on an agent's behalf. Gated `manageIntegrations`
 * (admin), same split as every other provider in `actions/integrations.ts`:
 * storing a credential is a materially different, higher-trust act than
 * using an already-connected one.
 *
 * A separate table (`mcpConnections`) and a separate action file from
 * `integrations.ts`, because an organization can connect arbitrarily many,
 * arbitrarily named MCP servers — see `packages/db/src/schema/mcp.ts`.
 */

export async function connectMcpServer(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageIntegrations", "connect an MCP server");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) return { ok: false, message: "Enter a name for this server." };

  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return { ok: false, message: "Enter a valid URL." };

  const apiKey = String(formData.get("apiKey") ?? "").trim() || undefined;

  const check = await new McpConnectorClient({ url, apiKey }).verifyConnection();
  let encrypted: { ciphertext: string; iv: string; authTag: string } | null = null;
  if (apiKey) {
    try {
      encrypted = encryptCredential(apiKey);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Could not encrypt the token." };
    }
  }

  const [row] = await db()
    .insert(schema.mcpConnections)
    .values({
      organizationId: session.workspace.organizationId,
      name,
      url,
      authMode: "api_key",
      encryptedApiKey: encrypted?.ciphertext ?? null,
      iv: encrypted?.iv ?? null,
      authTag: encrypted?.authTag ?? null,
      status: check.ok ? "active" : "error",
      lastVerifiedAt: check.ok ? new Date() : null,
      lastError: check.ok ? null : check.detail,
      toolsCache: check.tools ?? null,
      toolsCachedAt: check.ok ? new Date() : null,
      createdBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.mcpConnections.organizationId, schema.mcpConnections.name],
      targetWhere: sql`${schema.mcpConnections.revokedAt} is null`,
      set: {
        url,
        // Switching this name back to the API-key path — clear any OAuth
        // credential a previous connect under the same name may have left,
        // so the row can't end up with both an `authMode` and a stale blob
        // that disagree about how it authenticates.
        authMode: "api_key",
        encryptedApiKey: encrypted?.ciphertext ?? null,
        iv: encrypted?.iv ?? null,
        authTag: encrypted?.authTag ?? null,
        encryptedOAuth: null,
        oauthIv: null,
        oauthAuthTag: null,
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
    organizationId: session.workspace.organizationId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.integrationConnected,
    targetType: "mcp_connection",
    targetId: row!.id,
    metadata: { name, url },
  });

  revalidatePath("/settings/integrations");
  if (!check.ok) return { ok: false, message: `Saved, but couldn't reach it: ${check.detail}` };
  return { ok: true, message: `"${name}" connected. ${check.detail}` };
}

/**
 * Starts an OAuth connect: creates a short-lived `mcpOAuthAttempts` row,
 * runs discovery + dynamic client registration + PKCE via the MCP SDK's
 * `auth()`, and redirects the browser to the server's own authorization
 * page. The callback route (`app/(app)/settings/integrations/mcp/oauth/
 * callback/route.ts`) finishes the connect when the user comes back.
 *
 * `redirect()` throws, by design — `useAction()` on the client already
 * special-cases that (it re-throws rather than treating it as a failed
 * action), so this is the same mechanism every other Next server action in
 * this app uses to send the browser somewhere.
 */
export async function startMcpOAuthConnect(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageIntegrations", "connect an MCP server");
  if (refusal) return refusal;

  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) return { ok: false, message: "Enter a name for this server." };

  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\/.+/i.test(url)) return { ok: false, message: "Enter a valid URL." };

  const seededClient = await seedClientInformation(session.workspace.organizationId, name);
  const seedState = { clientInformation: seededClient };
  const seedEncrypted = encryptAttemptState(seedState);

  const [attempt] = await db()
    .insert(schema.mcpOAuthAttempts)
    .values({
      organizationId: session.workspace.organizationId,
      name,
      url,
      encryptedState: seedEncrypted.ciphertext,
      stateIv: seedEncrypted.iv,
      stateAuthTag: seedEncrypted.authTag,
      createdBy: session.user.id,
      expiresAt: new Date(Date.now() + MCP_OAUTH_ATTEMPT_TTL_MS),
    })
    .returning({ id: schema.mcpOAuthAttempts.id });

  const provider = new StatefulOAuthProvider({
    redirectUrl: mcpOAuthCallbackUrl(),
    state: attempt!.id,
    initial: seedState,
  });

  let authorizationUrl: URL;
  try {
    const result = await auth(provider, { serverUrl: url });
    if (result !== "REDIRECT" || !provider.lastAuthorizationUrl) {
      throw new Error("This server didn't ask for authorization — try the API key option instead.");
    }
    authorizationUrl = provider.lastAuthorizationUrl;
  } catch (error) {
    await db().delete(schema.mcpOAuthAttempts).where(eq(schema.mcpOAuthAttempts.id, attempt!.id));
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Couldn't start sign-in with this server: ${detail}` };
  }

  const encrypted = encryptAttemptState(provider.snapshot());
  await db()
    .update(schema.mcpOAuthAttempts)
    .set({ encryptedState: encrypted.ciphertext, stateIv: encrypted.iv, stateAuthTag: encrypted.authTag })
    .where(eq(schema.mcpOAuthAttempts.id, attempt!.id));

  redirect(authorizationUrl.toString());
}

export async function testMcpServerConnection(id: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageIntegrations", "test an MCP server connection");
  if (refusal) return refusal;

  const [row] = await db()
    .select()
    .from(schema.mcpConnections)
    .where(and(eq(schema.mcpConnections.id, id), eq(schema.mcpConnections.organizationId, session.workspace.organizationId)))
    .limit(1);
  if (!row) return { ok: false, message: "No such MCP server." };
  if (row.revokedAt) return { ok: false, message: "This connection has been revoked." };

  let apiKey: string | undefined;
  if (row.authMode === "oauth") {
    try {
      apiKey = await resolveOAuthAccessToken(db(), row);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not refresh this connection's OAuth token.";
      await db()
        .update(schema.mcpConnections)
        .set({ status: "error", lastError: message, updatedAt: new Date() })
        .where(eq(schema.mcpConnections.id, row.id));
      revalidatePath("/settings/integrations");
      return { ok: false, message };
    }
  } else {
    apiKey =
      row.encryptedApiKey && row.iv && row.authTag
        ? decryptCredential({ ciphertext: row.encryptedApiKey, iv: row.iv, authTag: row.authTag })
        : undefined;
  }
  const check = await new McpConnectorClient({ url: row.url, apiKey }).verifyConnection();

  await db()
    .update(schema.mcpConnections)
    .set({
      status: check.ok ? "active" : "error",
      lastVerifiedAt: check.ok ? new Date() : row.lastVerifiedAt,
      lastError: check.ok ? null : check.detail,
      ...(check.ok ? { toolsCache: check.tools ?? row.toolsCache, toolsCachedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.mcpConnections.id, row.id));

  revalidatePath("/settings/integrations");
  return check.ok ? { ok: true, message: check.detail } : { ok: false, message: check.detail };
}

export async function revokeMcpServerConnection(id: string): Promise<ActionResult> {
  const session = await requireSession();

  const refusal = deny(session.workspace.role, "manageIntegrations", "revoke an MCP server connection");
  if (refusal) return refusal;

  const [revoked] = await db()
    .update(schema.mcpConnections)
    .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.mcpConnections.id, id),
        eq(schema.mcpConnections.organizationId, session.workspace.organizationId),
        isNull(schema.mcpConnections.revokedAt),
      ),
    )
    .returning({ id: schema.mcpConnections.id, name: schema.mcpConnections.name });
  if (!revoked) return { ok: false, message: "No such MCP server to revoke." };

  audit(db(), {
    organizationId: session.workspace.organizationId,
    actorId: session.user.id,
    action: AUDIT_ACTIONS.integrationRevoked,
    targetType: "mcp_connection",
    targetId: revoked.id,
    metadata: { name: revoked.name },
  });

  revalidatePath("/settings/integrations");
  return { ok: true, message: `"${revoked.name}" disconnected.` };
}
