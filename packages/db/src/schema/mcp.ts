import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations } from "./tenancy";

/**
 * Remote MCP (Model Context Protocol) servers an organization has connected
 * — the reverse direction of `apps/mcp`, which is Falorb acting as an MCP
 * *server*. This table is Falorb acting as an MCP *client*: agents
 * (`@falorb/agents`'s `mcp` toolkit) call tools on these servers, whose
 * tools are never known ahead of time.
 *
 * Deliberately a separate table from `integration_connections` rather than a
 * new `provider` value there: that table's whole shape assumes at most one
 * (or one per project) row per provider, enforced by its partial unique
 * indexes. An organization can connect any number of MCP servers — a
 * Notion server, an internal tools server, a customer's server — each
 * arbitrary and user-named, which is a different cardinality entirely.
 *
 * Same encryption convention as `integration_connections`
 * (`packages/db/src/crypto.ts`, `INTEGRATION_CREDENTIAL_ENC_KEY`) — except
 * the credential columns are nullable here, because some MCP servers require
 * no authentication at all.
 */
export const mcpConnectionStatusEnum = pgEnum("mcp_connection_status", [
  "active",
  "revoked",
  "error",
]);

/**
 * How a connection authenticates. `api_key` is the original, static-bearer
 * path (`encryptedApiKey`/`iv`/`authTag`, possibly all null for a server
 * that needs no auth at all). `oauth` is the MCP-spec flow — RFC 9728 +
 * RFC 8414 discovery, RFC 7591 dynamic client registration, OAuth 2.1
 * authorization-code + PKCE — for servers that require redirecting the
 * user to their own site to authenticate. See `packages/db/src/mcp-oauth.ts`
 * for the encrypted-blob shape stored in `encryptedOAuth`.
 */
export const mcpAuthModeEnum = pgEnum("mcp_auth_mode", ["api_key", "oauth"]);

export interface McpToolSummary {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export const mcpConnections = pgTable(
  "mcp_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Human label, unique per org while active — "Notion", "Internal tools". */
    name: text("name").notNull(),
    /** The server's MCP endpoint (Streamable HTTP or SSE). */
    url: text("url").notNull(),
    authMode: mcpAuthModeEnum("auth_mode").notNull().default("api_key"),
    /** AES-256-GCM ciphertext, hex-encoded. Null when the server needs no auth or uses OAuth. */
    encryptedApiKey: text("encrypted_api_key"),
    iv: text("iv"),
    authTag: text("auth_tag"),
    /**
     * AES-256-GCM ciphertext of a JSON blob — access/refresh tokens, the
     * dynamically-registered OAuth client, and cached discovery state — set
     * only when `authMode` is `"oauth"`. See `packages/db/src/mcp-oauth.ts`.
     */
    encryptedOAuth: text("encrypted_oauth"),
    oauthIv: text("oauth_iv"),
    oauthAuthTag: text("oauth_auth_tag"),
    /** Bumped when `INTEGRATION_CREDENTIAL_ENC_KEY` rotates — see `integration_connections.keyVersion`. */
    keyVersion: integer("key_version").notNull().default(1),
    status: mcpConnectionStatusEnum("status").notNull().default("active"),
    /** Set by connect/test — a reachability + `tools/list` check, not a data sync. */
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    /**
     * Cached from the last successful `tools/list`, so `list_mcp_tools` and
     * the dashboard's tool-count column don't need a live round trip on
     * every read. Refreshed on connect/test and opportunistically by
     * `list_mcp_tools` when stale.
     */
    toolsCache: jsonb("tools_cache").$type<McpToolSummary[]>(),
    toolsCachedAt: timestamp("tools_cached_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    // One active connection per name per org — reconnecting the same name
    // rotates the row. Partial so a revoked row doesn't block reusing its
    // name, same reasoning as integration_connections' partial indexes.
    uniqueIndex("mcp_connections_org_name_uq")
      .on(t.organizationId, t.name)
      .where(sql`${t.revokedAt} is null`),
    index("mcp_connections_org_idx").on(t.organizationId),
  ],
);

/**
 * A single in-flight "connect an MCP server with OAuth" attempt — the
 * server-side state that has to survive the round trip out to the
 * authorization server and back, since the SDK's OAuth client provider
 * needs the dynamically-registered client and the PKCE code verifier again
 * on the callback leg (it throws without them), and never validates a
 * `state` param itself. This row's `id`, reused as that `state` param, *is*
 * the CSRF defense: the callback route looks a code up by deleting the row
 * matching both `id` and the caller's own `organizationId` in one atomic
 * statement, so a guessed or replayed state can't complete a connect for a
 * different org, and a second hit on the same callback finds nothing left
 * to act on.
 *
 * Never holds tokens — those only exist after the callback succeeds, at
 * which point they go straight into `mcpConnections.encryptedOAuth`, not
 * here. Short-lived by design (`expiresAt`); an abandoned attempt is just
 * an inert row, not a live credential.
 */
export const mcpOAuthAttempts = pgTable(
  "mcp_oauth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** AES-256-GCM ciphertext of `{clientInformation?, codeVerifier?, discoveryState?}`. */
    encryptedState: text("encrypted_state").notNull(),
    stateIv: text("state_iv").notNull(),
    stateAuthTag: text("state_auth_tag").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("mcp_oauth_attempts_org_idx").on(t.organizationId)],
);
