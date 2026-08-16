import "server-only";
import type { ClickHouseClient } from "@clickhouse/client";
import { createClickHouse } from "@falorb/db";

/**
 * One ClickHouse client for the whole server process.
 *
 * The client holds a keep-alive HTTP agent with a connection pool. Next
 * re-evaluates modules on every hot reload in development, so a fresh client
 * per module evaluation leaks a pool per edit and eventually exhausts the
 * server's connection limit. Stashing it on `globalThis` survives that.
 *
 * The dashboard only reads, so the write-path settings the shared factory
 * applies (`async_insert` and friends) are inert here.
 */

const KEY = Symbol.for("falorb.clickhouse");

type Global = typeof globalThis & { [KEY]?: ClickHouseClient };

export function ch(): ClickHouseClient {
  const store = globalThis as Global;
  store[KEY] ??= createClickHouse();
  return store[KEY];
}
