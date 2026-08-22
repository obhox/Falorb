import type { ClickHouseClient } from "@clickhouse/client";
import Redis from "ioredis";
import { createClickHouse, createDatabase, schema } from "@falorb/db";
import type { Database } from "@falorb/db";
import { type SyncDemandBackend } from "@falorb/core";

export { schema };
export type { Database };

/** Shared connections, created once and passed to every job. */
export interface WorkerContext {
  db: Database;
  clickhouse: ClickHouseClient;
  redis: Redis;
  /** Which orgs' integration mirrors (buffer/linki/bund_ai/stripe/migadu) a
   * request has flagged as wanting a fresh sync — see `jobs/*-sync.ts`. */
  syncDemand: SyncDemandBackend;
  /** project id -> organization id. */
  projectOrgs: Map<number, string>;
  /** Projects that unify identity across the organization's portfolio. */
  orgScopedProjects: Set<number>;
  /** Per-project retention in days. */
  retentionDays: Map<number, number>;
  projectIds: number[];
}

/** Redis-backed `SyncDemandBackend`: a set per provider, drained (read + cleared) each tick. */
function createRedisSyncDemand(redis: Redis): SyncDemandBackend {
  const key = (provider: string) => `falorb:sync:requested:${provider}`;
  return {
    async request(provider, orgId) {
      await redis.sadd(key(provider), orgId);
    },
    async drain(provider) {
      const k = key(provider);
      const orgIds = await redis.smembers(k);
      if (orgIds.length) await redis.del(k);
      return orgIds;
    },
  };
}

export function chDateTime(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").replace("Z", "");
}

export function chDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export async function createContext(): Promise<WorkerContext> {
  const db = createDatabase();
  const clickhouse = createClickHouse();
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", {
    maxRetriesPerRequest: null,
  });
  redis.on("error", (e) => console.error("[redis]", e.message));

  const context: WorkerContext = {
    db,
    clickhouse,
    redis,
    syncDemand: createRedisSyncDemand(redis),
    projectOrgs: new Map(),
    orgScopedProjects: new Set(),
    retentionDays: new Map(),
    projectIds: [],
  };

  await refreshProjects(context);
  return context;
}

/**
 * Reload project metadata.
 *
 * Jobs need the project -> organization mapping constantly and it changes
 * rarely, so it is held in memory and refreshed on its own schedule rather
 * than queried per job run.
 */
export async function refreshProjects(context: WorkerContext): Promise<void> {
  const rows = await context.db.select().from(schema.projects);

  context.projectOrgs = new Map(rows.map((r) => [r.id, r.organizationId]));
  context.orgScopedProjects = new Set(
    rows.filter((r) => r.identityScope === "org").map((r) => r.id),
  );
  context.retentionDays = new Map(rows.map((r) => [r.id, r.retentionDays]));
  context.projectIds = rows.filter((r) => !r.archivedAt).map((r) => r.id);
}
