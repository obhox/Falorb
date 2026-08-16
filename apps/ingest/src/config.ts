export interface IngestConfig {
  port: number;
  redisUrl: string;
  databaseUrl: string;
  saltSecret: string;
  maxmindPath: string;
  /** Events per minute allowed from one ip_hash before requests are shed. */
  rateLimitPerIp: number;
  /**
   * Events per minute allowed for one project across all senders. Bounds a
   * distributed flood, which the per-IP limit cannot see.
   */
  rateLimitPerProject: number;
  /** Serve the tracker bundle from this path on disk. */
  trackerPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const saltSecret = env.FALORB_SALT_SECRET ?? "";
  if (saltSecret.length < 16) {
    // Refuse to start rather than silently hashing IPs with a guessable salt —
    // a weak salt makes the hash reversible by brute force over the IPv4 space,
    // which would turn a privacy measure into a false claim.
    throw new Error(
      "FALORB_SALT_SECRET must be at least 16 characters. Generate one with: openssl rand -hex 32",
    );
  }

  return {
    port: Number(env.PORT ?? 3001),
    redisUrl: env.REDIS_URL ?? "redis://localhost:6380",
    databaseUrl: env.DATABASE_URL ?? "",
    saltSecret,
    maxmindPath: env.MAXMIND_DB_PATH ?? "",
    rateLimitPerIp: Number(env.FALORB_RATE_LIMIT ?? 600),
    rateLimitPerProject: Number(env.FALORB_RATE_LIMIT_PROJECT ?? 60_000),
    trackerPath:
      env.FALORB_TRACKER_PATH ?? new URL("../../../packages/tracker/dist/t.js", import.meta.url).pathname,
  };
}

/** Redis stream that ingest writes to and the ch-writer worker consumes. */
export const EVENT_STREAM = "falorb:events";
