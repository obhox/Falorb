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
 * support), Buffer and Postiz (social posting), Clay (prospect contact
 * enrichment, see FEATURES.md §17), Exa/Firecrawl (web research, see
 * FEATURES.md §14k), ElevenLabs (UGC video generation, see FEATURES.md §18),
 * OpenSEO (keyword/SERP/backlink/rank-tracking data, called live when
 * drafting content and for per-project SEO monitoring — its own MCP server
 * is the only surface it exposes, so `@falorb/openseo-client` speaks MCP
 * instead of REST; see that package for why the row shape still fits here
 * unchanged), Migadu (cold-outreach mailbox provisioning, see
 * `packages/migadu-client` and `email.ts`), and the two AI gateways —
 * OpenRouter and Ramp Router (router.com) — an organization can bring its
 * own account and model on (see FEATURES.md §19 and `@falorb/ai`'s
 * `credentials.ts`) today, more over time. One table, not one per provider,
 * because the shape is identical: a base URL, an encrypted key, and a
 * status a sync job can check before calling out.
 *
 * Buffer's, Postiz's, Clay's, Exa/Firecrawl's, ElevenLabs', OpenSEO's, and
 * Migadu's `baseUrl` are each a fixed API root rather than user-entered
 * (unlike Linki/Bund AI's self-hosted deployments) — set server-side, not
 * exposed on their connect forms. Stored per-row anyway rather than
 * special-cased, so every provider fits this one table without a schema
 * exception.
 *
 * Migadu is the one provider whose management API needs two secrets, not
 * one — HTTP Basic Auth over an admin email plus an API key. Rather than add
 * a column only this provider uses, `encryptedApiKey` holds
 * `JSON.stringify({ username, apiKey })` for Migadu specifically; see
 * `apps/api/src/routes/integrations.ts`'s connect handler for where that's
 * assembled, and `MigaduClient`'s constructor for where it's parsed back
 * out.
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
  "postiz",
  "clay",
  "exa",
  "firecrawl",
  "elevenlabs",
  "migadu",
  "openrouter",
  "router",
  "gemini",
  "github",
  "openseo",
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
    /**
     * Which model to ask for — only meaningful for the AI providers
     * (`openrouter`, `router`, `gemini`), null for every other provider,
     * which has no such choice to make.
     *
     * Nullable rather than defaulted because the three differ on what null
     * means: on OpenRouter it falls back to `openrouter/auto`, its own
     * per-request selection, which is the platform's deliberate default
     * (see `resolveModel`); Ramp Router and Gemini have no auto model at
     * all, so their connect forms ask for one. A comma-separated value is a
     * fallback chain on OpenRouter and, where every entry is
     * provider-qualified, on Ramp Router; Gemini takes only the first.
     */
    model: text("model"),
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

/**
 * Repo-specific config for a `github` connection — where to commit and how
 * to shape the file. Kept off `integration_connections` deliberately: that
 * table's whole design point is one identical shape for every provider, and
 * this config (owner/repo/branch/path template) has no equivalent on any
 * other provider. One row per connection for now — a second content path on
 * the same repo would mean a second connection, not a second target row.
 */
export const blogPublishTargets = pgTable(
  "blog_publish_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationConnectionId: uuid("integration_connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    /** GitHub org or user that owns the repo. */
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    branch: text("branch").notNull().default("main"),
    /** e.g. "content/blog/{slug}.md" — {slug} is the draft title, kebab-cased. */
    pathTemplate: text("path_template").notNull().default("content/blog/{slug}.md"),
    /** YAML frontmatter template with {title}/{description}/{date} placeholders, prepended to the body on publish. */
    frontmatterTemplate: text("frontmatter_template"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("blog_publish_targets_connection_uq").on(t.integrationConnectionId),
  ],
);
