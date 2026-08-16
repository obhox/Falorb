import { createClient, type ClickHouseClient } from "@clickhouse/client";

export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

export function clickhouseConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
    username: env.CLICKHOUSE_USER ?? "falorb",
    password: env.CLICKHOUSE_PASSWORD ?? "falorb",
    database: env.CLICKHOUSE_DATABASE ?? "falorb",
  };
}

/**
 * Build a ClickHouse client.
 *
 * `async_insert` is on: the writer sends batches every second, and letting the
 * server coalesce them further keeps part creation low. ClickHouse degrades
 * badly under many small inserts — each one creates a part the background
 * merger then has to clean up — so this matters more than it looks.
 *
 * `wait_for_async_insert: 1` is deliberate and non-obvious. With 0, the server
 * acknowledges the HTTP request before parsing the batch, so a malformed row
 * is dropped with no error ever reaching the client — silent data loss that
 * looks exactly like "the tracker isn't firing". Waiting for the flush costs a
 * few milliseconds per batch and, critically, lets the writer only ACK the
 * Redis stream entry once the rows are genuinely durable. A crash then replays
 * the batch instead of losing it.
 */
export function createClickHouse(
  config: ClickHouseConfig = clickhouseConfigFromEnv(),
  overrides: Record<string, unknown> = {},
): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 1,
      async_insert_max_data_size: "10485760",
      async_insert_busy_timeout_ms: 1000,
      date_time_input_format: "best_effort",
      ...overrides,
    },
    compression: { response: true, request: false },
  });
}

/**
 * Client without a bound database, for bootstrap operations that must run
 * before the database exists.
 */
export function createBootstrapClient(
  config: ClickHouseConfig = clickhouseConfigFromEnv(),
): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
  });
}
