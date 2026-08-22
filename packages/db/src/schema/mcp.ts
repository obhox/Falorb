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
 * (`@falorb/agents`'s `mcp` toolkit) call tools on these servers, the same
 * way `@falorb/openseo-client` already calls OpenSEO's hosted MCP endpoint —
 * except OpenSEO is one fixed, known server with a hardcoded capability→tool
 * map, and this table holds arbitrarily many, arbitrarily named servers
 * whose tools are never known ahead of time.
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
    /** AES-256-GCM ciphertext, hex-encoded. Null when the server needs no auth. */
    encryptedApiKey: text("encrypted_api_key"),
    iv: text("iv"),
    authTag: text("auth_tag"),
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
