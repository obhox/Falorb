import { createDatabase, schema, type Database } from "@falorb/db";

export interface CachedProject {
  id: number;
  organizationId: string;
  publicKey: string;
  domains: string[];
  consentMode: "off" | "opt_in" | "opt_out";
  cookieless: boolean;
  identityScope: "project" | "org";
  timezone: string;
  archived: boolean;
  /** Per-project config: PII masking rules, excluded paths. */
  settings: unknown;
}

/**
 * In-memory project cache.
 *
 * Every incoming batch has to resolve a public key to a project. Doing that
 * with a Postgres query per request would put a database round-trip in front
 * of every pageview on every tracked site and cap throughput at whatever the
 * connection pool allows. Projects change perhaps once a week, so they are
 * cached in process and refreshed on a timer.
 *
 * Negative results are cached too, and for the same reason: a bad or revoked
 * key being hammered by a stale tracker must not become a database load
 * generator.
 */
export class ProjectCache {
  private byKey = new Map<string, CachedProject | null>();
  private lastRefresh = 0;
  private refreshing: Promise<void> | null = null;
  private db: Database;

  constructor(
    databaseUrl: string,
    private ttlMs = 60_000,
  ) {
    this.db = createDatabase(databaseUrl);
  }

  async get(publicKey: string): Promise<CachedProject | null> {
    const cached = this.byKey.get(publicKey);
    if (cached !== undefined && Date.now() - this.lastRefresh < this.ttlMs) {
      return cached;
    }
    if (cached !== undefined) {
      // Serve the stale value immediately and refresh behind it, so a slow
      // database never becomes ingest latency.
      void this.refresh();
      return cached;
    }
    await this.refresh();
    return this.byKey.get(publicKey) ?? null;
  }

  /** Collapses concurrent refreshes into one query. */
  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.load().finally(() => {
      this.refreshing = null;
      this.lastRefresh = Date.now();
    });
    return this.refreshing;
  }

  private async load(): Promise<void> {
    // Load every project in one query. At this scale the whole table is a few
    // dozen rows, so paginating or filtering would cost more than it saves.
    const rows = await this.db.select().from(schema.projects);

    const next = new Map<string, CachedProject | null>();
    for (const row of rows) {
      next.set(row.publicKey, {
        id: row.id,
        organizationId: row.organizationId,
        publicKey: row.publicKey,
        domains: row.domains ?? [],
        consentMode: row.consentMode,
        cookieless: row.cookieless === 1,
        identityScope: row.identityScope,
        timezone: row.timezone,
        archived: row.archivedAt !== null,
        settings: row.settings,
      });
    }
    this.byKey = next;
  }

  /** Remember that a key does not exist, so repeats are answered from memory. */
  markMissing(publicKey: string): void {
    if (!this.byKey.has(publicKey)) this.byKey.set(publicKey, null);
  }
}

/**
 * Verify the request's Origin against the project's allowed domains.
 *
 * The public key is embedded in the page source and therefore not a secret;
 * this check is what stops a leaked key being used to inject junk into someone
 * else's reports. A project with no domains configured accepts any origin,
 * which is the pragmatic default during initial setup.
 */
export function originAllowed(project: CachedProject, origin: string | null): boolean {
  if (!project.domains.length) return true;
  if (!origin) return true; // non-browser clients (server-side SDK) send no Origin
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  return project.domains.some((d) => {
    const allowed = d.toLowerCase().replace(/^www\./, "");
    // A configured apex domain also authorises its subdomains, so app.x.com
    // works without listing every host separately.
    return host === allowed || host.endsWith("." + allowed);
  });
}
