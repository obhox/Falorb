import "server-only";
import { ownerOf } from "@/lib/domain-match";
import { hostStatus, installStatus } from "./analytics";

/**
 * Is this property actually connected?
 *
 * "I pasted the snippet — is it working?" has had no answer in this product.
 * An empty dashboard looks exactly like a quiet week, so a broken install and
 * a slow Tuesday were indistinguishable, and the only way to tell them apart
 * was to know which ClickHouse table to query.
 *
 * Three states, because they have three different remedies:
 *
 *   waiting    nothing has ever arrived — the snippet is missing, blocked, or
 *              on a domain this property does not authorise
 *   live       events in the last 24 hours — nothing to do
 *   silent     events once, none lately — it worked and then stopped, which is
 *              a different and more alarming problem than never having worked
 */

export type ConnectionState = "waiting" | "live" | "silent";

export interface ConnectionStatus {
  state: ConnectionState;
  firstEventAt: string | null;
  lastEventAt: string | null;
  events24h: number;
  eventsTotal: number;
}

/** How long without events before a working install is called silent. */
const SILENT_AFTER_MS = 24 * 3_600_000;

export async function getConnectionStatus(projectId: number): Promise<ConnectionStatus> {
  const [row] = await installStatus({ projectIds: [projectId] }).catch(() => []);

  if (!row || Number(row.events_total) === 0) {
    return {
      state: "waiting",
      firstEventAt: null,
      lastEventAt: null,
      events24h: 0,
      eventsTotal: 0,
    };
  }

  const events24h = Number(row.events_24h);

  return {
    state: events24h > 0 ? "live" : "silent",
    firstEventAt: row.first_event,
    lastEventAt: row.last_event,
    events24h,
    eventsTotal: Number(row.events_total),
  };
}

export interface DomainStatus {
  /** The domain exactly as it is configured on the property. */
  domain: string;
  state: ConnectionState;
  lastEventAt: string | null;
  events24h: number;
  eventsTotal: number;
  /**
   * The hosts whose events counted towards this domain. More than one means
   * subdomains are reporting under a configured apex, which is worth showing:
   * it is the difference between "the site works" and "which site works".
   */
  hosts: string[];
}

/**
 * Which of a property's configured domains are actually sending events.
 *
 * The property-level verdict cannot answer this. A configured apex authorises
 * every subdomain beneath it, so one working site makes the whole property
 * look connected while a second domain on the same property sends nothing —
 * and a missing snippet on the app is exactly the install mistake people make
 * after getting the marketing site right.
 *
 * Attribution follows the collector's rule, longest match first: an event on
 * `app.evyos.com` belongs to `app.evyos.com` when that is configured, and
 * falls back to the `evyos.com` apex when it is not. Hosts matching no
 * configured domain are ignored here — they were either collected during the
 * open setup window before the domain list existed, or they are a domain that
 * has since been removed, and neither is a statement about a domain that *is*
 * configured.
 */
export async function getDomainStatuses(
  properties: Array<{ id: number; domains: string[] }>,
): Promise<Map<number, DomainStatus[]>> {
  const blank = (domain: string): DomainStatus => ({
    domain,
    state: "waiting",
    lastEventAt: null,
    events24h: 0,
    eventsTotal: 0,
    hosts: [],
  });

  // Every property starts at "waiting", including ones with no domains, so a
  // caller always gets an entry and never has to distinguish "no data" from
  // "not queried".
  const result = new Map<number, DomainStatus[]>(
    properties.map((p) => [p.id, p.domains.map(blank)]),
  );

  const withDomains = properties.filter((p) => p.domains.length);
  if (!withDomains.length) return result;

  // One query for the whole page. The workspace settings list shows every
  // property, and a query per property would put ten ClickHouse round-trips
  // behind a settings page load.
  //
  // A failed query must not take that page down: the panel's whole purpose is
  // being readable when something is broken, so an error degrades to "waiting"
  // rather than an exception.
  const rows = await hostStatus({ projectIds: withDomains.map((p) => p.id) }).catch(() => []);

  for (const property of withDomains) {
    const statuses = result.get(property.id);
    if (!statuses) continue;

    const byDomain = new Map(statuses.map((s) => [s.domain, s]));

    for (const row of rows) {
      if (Number(row.project_id) !== property.id) continue;

      const owner = ownerOf(row.host, property.domains);
      if (!owner) continue;

      const status = byDomain.get(owner);
      if (!status) continue;

      status.events24h += Number(row.events_24h);
      status.eventsTotal += Number(row.events_total);
      status.hosts.push(row.host);
      if (!status.lastEventAt || row.last_event > status.lastEventAt) {
        status.lastEventAt = row.last_event;
      }
    }

    for (const status of statuses) {
      status.state =
        status.eventsTotal === 0 ? "waiting" : status.events24h > 0 ? "live" : "silent";
    }
  }

  return result;
}

export interface CollectorHealth {
  reachable: boolean;
  redis: boolean;
  tracker: boolean;
  /** "database" | "header" | "none" — which source resolves country. */
  geoSource: string;
}

/**
 * Ask the collector about itself.
 *
 * The dashboard and the collector are separate services on separate
 * hostnames, so "the dashboard loads" says nothing about whether the thing
 * receiving events is healthy. This is the one place that distinction is
 * visible without a terminal.
 *
 * Failure is reported, never thrown: an unreachable collector is precisely the
 * condition worth showing, so it must not take the settings page down with it.
 */
export async function getCollectorHealth(): Promise<CollectorHealth> {
  const base = process.env.FALORB_INGEST_URL ?? "http://localhost:3001";

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/health`, {
      // The panel is server-rendered on every settings view; a hung collector
      // must not hold that render open.
      signal: AbortSignal.timeout(4_000),
      cache: "no-store",
    });

    if (!response.ok) {
      return { reachable: false, redis: false, tracker: false, geoSource: "none" };
    }

    const body = (await response.json()) as {
      redis?: boolean;
      tracker?: boolean;
      geoSource?: string;
    };

    return {
      reachable: true,
      redis: body.redis === true,
      tracker: body.tracker === true,
      geoSource: body.geoSource ?? "none",
    };
  } catch {
    return { reachable: false, redis: false, tracker: false, geoSource: "none" };
  }
}
