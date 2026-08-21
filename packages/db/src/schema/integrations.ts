import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations, projects } from "./tenancy";

/**
 * Credentials Falorb holds to call another product's API on the
 * organization's behalf — Linki (sales/outreach), Bund AI (customer
 * support), Buffer (social posting), Clay (prospect contact enrichment, see
 * FEATURES.md §17), Exa/Firecrawl (web research, see FEATURES.md §14k), and
 * ElevenLabs (UGC video generation, see FEATURES.md §18) today, more over
 * time. One table, not one per provider, because the shape is identical: a
 * base URL, an encrypted key, and a status a sync job can check before
 * calling out.
 *
 * Buffer's, Clay's, Exa/Firecrawl's, and ElevenLabs' `baseUrl` are each a
 * fixed API root rather than user-entered (unlike Linki/Bund AI's
 * self-hosted deployments) — set server-side, not exposed on their connect
 * forms. Stored per-row anyway rather than special-cased, so every provider
 * fits this one table without a schema exception.
 *
 * The key is stored encrypted, not hashed, unlike `api_keys`. Those keys are
 * only ever compared against a caller-presented value; this key must be
 * presented in plaintext *to* the other product on every outbound call, so a
 * one-way hash would be useless here.
 *
 * A row is either org-level (`projectId` null) or a project-level override
 * (`projectId` set) — same table, same shape, `activeConnection` in
 * `apps/web/src/server/integrations.ts` prefers the project's row and falls
 * back to the org's when the project has none for that provider.
 */
export const integrationProviderEnum = pgEnum("integration_provider", [
  "linki",
  "bund_ai",
  "buffer",
  "clay",
  "exa",
  "firecrawl",
  "elevenlabs",
]);

export const integrationStatusEnum = pgEnum("integration_status", [
  "active",
  "revoked",
  "error",
]);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * Null means an org-level connection, used by every project that has no
     * connection of its own. Set means a project overriding the org's
     * connection for this provider — `activeConnection` in
     * `apps/web/src/server/integrations.ts` looks up the project-scoped row
     * first and falls back to the org-scoped one.
     */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM ciphertext, hex-encoded. Never returned by any API response. */
    encryptedApiKey: text("encrypted_api_key").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    /**
     * Bumped when `INTEGRATION_CREDENTIAL_ENC_KEY` rotates, so a stored row
     * carries which key it was encrypted under instead of silently failing
     * to decrypt after a rotation.
     */
    keyVersion: integer("key_version").notNull().default(1),
    status: integrationStatusEnum("status").notNull().default("active"),
    /** Set by the manual "test connection" action — a reachability check, not a data sync. */
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    /** Set by the mirror job (`linki-sync`/`bund-ai-sync`) on a completed full sync — this is the connection-health signal the sync UI shows. */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    // One org-level connection per provider per org — reconnecting rotates
    // the same row. A plain unique index on (organizationId, provider,
    // projectId) would not enforce this on its own: SQL never treats two
    // NULLs as equal, so it would happily accept a second org-level (NULL
    // projectId) row for the same provider. Partial, so it only applies to
    // org-level rows.
    uniqueIndex("integration_connections_org_provider_uq")
      .on(t.organizationId, t.provider)
      .where(sql`${t.projectId} is null`),
    // One project-level override per provider per project.
    uniqueIndex("integration_connections_project_provider_uq")
      .on(t.organizationId, t.projectId, t.provider)
      .where(sql`${t.projectId} is not null`),
    index("integration_connections_org_idx").on(t.organizationId),
    index("integration_connections_project_idx").on(t.projectId),
  ],
);
