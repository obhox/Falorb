import "server-only";
import { installStatus } from "./analytics";

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
