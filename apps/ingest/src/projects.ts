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
  /** Bounds the setup window during which an empty domain list accepts any origin. */
  createdAt: Date;
  /** Per-project config: PII masking rules, excluded paths, `serverSide`. */
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
        createdAt: row.createdAt,
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
 * How long a project with no configured domains keeps accepting any origin.
 *
 * Setup needs a window where events arrive before the domain list is filled
 * in, or the first-run experience is "nothing works and nothing says why". It
 * does not need that window to last forever, which is what an unconditional
 * `return true` amounted to.
 */
const OPEN_SETUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Verify the request's Origin against the project's allowed domains.
 *
 * The public key ships in the customer's page source and is not a secret, so
 * this check is the only thing standing between a passer-by and write access
 * to someone else's reports. For an analytics product the integrity of those
 * reports *is* the product, so the two escape hatches that used to be here are
 * now bounded:
 *
 *   A project with no domains configured accepted anything, permanently, and
 *   that is the default state of every newly created project. It is now a
 *   24-hour setup window measured from project creation.
 *
 *   A request with no `Origin` header was accepted unconditionally, for
 *   server-side SDKs. But `curl` sends no Origin either, so this exempted
 *   exactly the clients an attacker would use. Origin-less collection is now
 *   opt-in per project via `settings.serverSide`.
 */
export function originAllowed(
  project: CachedProject,
  origin: string | null,
  now: number = Date.now(),
): boolean {
  if (!project.domains.length) {
    return now - project.createdAt.getTime() < OPEN_SETUP_WINDOW_MS;
  }

  if (!origin) {
    const settings = (project.settings ?? {}) as { serverSide?: unknown };
    return settings.serverSide === true;
  }

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
