import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export * as schema from "./schema/index";
export * from "./clickhouse/index";
export * from "./api-keys";
export * from "./audit";
export * from "./workspace";
export * from "./roles";
export * from "./crypto";
export * from "./ai-credentials";

export type Database = ReturnType<typeof createDatabase>;

let cached: ReturnType<typeof createDatabase> | undefined;

export function createDatabase(url: string = process.env.DATABASE_URL ?? "") {
  if (!url) throw new Error("DATABASE_URL is not set");
  // `max: 10` suits a single-server deployment where the dashboard, worker and
  // ingest all share one Postgres. Raise it only alongside Postgres' own
  // max_connections.
  const client = postgres(url, { max: 10, prepare: false });
  return drizzle(client, { schema });
}

/** Process-wide singleton, so Next.js hot reloads do not exhaust connections. */
export function db(): Database {
  cached ??= createDatabase();
  return cached;
}
