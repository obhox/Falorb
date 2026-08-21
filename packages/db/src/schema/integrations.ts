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
import { organizations } from "./tenancy";

/**
 * Credentials Falorb holds to call another product's API on the
 * organization's behalf — Linki (sales/outreach), Bund AI (customer
 * support), Buffer (social posting), Clay (prospect contact enrichment, see
 * FEATURES.md §17), and ElevenLabs (UGC video generation, see FEATURES.md
 * §18) today, more over time. One table, not one per provider, because the
 * shape is identical: a base URL, an encrypted key, and a status a sync job
 * can check before calling out.
 *
 * Buffer's, Clay's, and ElevenLabs' `baseUrl` are each a fixed API root
 * rather than user-entered (unlike Linki/Bund AI's self-hosted deployments)
 * — set server-side, not exposed on their connect forms. Stored per-row
 * anyway rather than special-cased, so every provider fits this one table
 * without a schema exception.
 *
 * The key is stored encrypted, not hashed, unlike `api_keys`. Those keys are
 * only ever compared against a caller-presented value; this key must be
 * presented in plaintext *to* the other product on every outbound call, so a
 * one-way hash would be useless here.
 */
export const integrationProviderEnum = pgEnum("integration_provider", [
  "linki",
  "bund_ai",
  "buffer",
  "clay",
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
    // One connection per provider per org — reconnecting rotates the same row.
    uniqueIndex("integration_connections_org_provider_uq").on(t.organizationId, t.provider),
    index("integration_connections_org_idx").on(t.organizationId),
  ],
);
