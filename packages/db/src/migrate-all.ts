import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { migrate as migrateClickHouse } from "./clickhouse/migrate";

/**
 * Applies both schemas. This is what runs on deploy.
 *
 * Uses drizzle-orm's *programmatic* migrator rather than the `drizzle-kit`
 * CLI. drizzle-kit is a dev dependency, and a production image built with
 * `--prod` does not contain it — so a container calling `drizzle-kit migrate`
 * fails at exactly the moment it matters. drizzle-orm is a runtime dependency
 * and is always present.
 *
 * ClickHouse runs first. Its migrations are additive and idempotent, while a
 * half-applied Postgres migration is the one that leaves the control plane
 * unusable — so the riskier step goes last, when the cheaper one has already
 * proven the databases are reachable.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  console.log("→ ClickHouse");
  await migrateClickHouse();

  console.log("\n→ Postgres");
  // A dedicated single connection: the migrator takes an advisory lock, and
  // sharing a pooled connection with anything else risks it being handed out
  // mid-migration.
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await migratePostgres(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
    console.log("  migrations applied");
  } finally {
    await client.end();
  }

  console.log("\nSchema is up to date.");
  process.exit(0);
}

main().catch((error) => {
  console.error("\nMigration failed:", error);
  // Non-zero so the compose dependency gate stops the apps from starting
  // against a schema that was never applied.
  process.exit(1);
});
