"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Card, Icon, StatTile } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { BreakdownCard } from "@/components/BreakdownCard";
import { clockTime, countryLabel, duration, eventLabel, num, prettyPath } from "@/lib/format";

/**
 * The realtime view.
 *
 * State arrives over SSE and is rendered as it lands. The event feed is capped
 * at `FEED_LIMIT` rows — an unbounded list on a busy property grows without
 * limit and eventually stalls the tab, and nobody scrolls back through a live
 * feed anyway.
 */

const FEED_LIMIT = 60;

interface LiveVisitor {
  person_id: string;
  current_path: string;
  country: string;
  city: string;
  device_type: string;
  browser: string;
  channel: string;
  pageviews: number;
  seconds_on_site: number;
}

interface LiveEvent {
  timestamp: string;
  person_id: string;
  name: string;
  path: string;
  country: string;
  device_type: string;
}

interface Tick {
  visitors: number;
  active: LiveVisitor[];
  events: LiveEvent[];
  at: number;
}

type Status = "connecting" | "live" | "reconnecting";

export function LiveView({ slug }: { slug: string }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [tick, setTick] = useState<Tick | null>(null);
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const source = new EventSource(`/api/live/${encodeURIComponent(slug)}`);

    source.addEventListener("hello", () => setStatus("live"));

    source.addEventListener("tick", (event) => {
      setStatus("live");
      const payload = JSON.parse((event as MessageEvent).data) as Tick;
      setTick(payload);

      if (payload.events.length > 0) {
        setFeed((current) => {
          // The server advances its cursor, but a reconnect restarts it, so
          // dedupe here as well rather than trusting the transport.
          const fresh = payload.events.filter((e) => {
            const key = `${e.timestamp}:${e.person_id}:${e.name}:${e.path}`;
            if (seen.current.has(key)) return false;
            seen.current.add(key);
            return true;
          });
          if (fresh.length === 0) return current;
          return [...fresh.reverse(), ...current].slice(0, FEED_LIMIT);
        });
      }
    });

    // EventSource reconnects on its own; this only reflects that in the UI.
    source.onerror = () => setStatus("reconnecting");

    return () => source.close();
  }, [slug]);

  const visitors = tick?.active ?? [];
  const paths = rank(visitors, (v) => v.current_path || "/");
  const countries = rank(visitors, (v) => v.country);

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: "var(--space-6)",
        }}
      >
        <StatTile
          label="On site now"
          value={tick ? num(tick.visitors) : "—"}
          size="lg"
          footnote={<ConnectionState status={status} at={tick?.at} />}
        />
        <StatTile
          label="Pages being viewed"
          value={tick ? num(paths.length) : "—"}
        />
        <StatTile
          label="Countries"
          value={tick ? num(countries.length) : "—"}
        />
        <StatTile
          label="Events streaming"
          value={num(feed.length)}
          footnote={`most recent ${FEED_LIMIT}`}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)",
          gap: "var(--space-6)",
          alignItems: "start",
        }}
      >
        <Card
          title="Event feed"
          subtitle="Newest first, as it arrives"
          padding={0}
          bodyStyle={{ padding: 0 }}
        >
          {feed.length === 0 ? (
            <Empty
              dense
              icon="radio"
              title="Waiting for events"
              body={
                status === "live"
                  ? "Connected. Nothing has been sent since this page opened — the feed shows new events only, not history."
                  : "Connecting to the event stream."
              }
            />
          ) : (
            <div style={{ display: "grid" }}>
              {feed.map((event, index) => (
                <div
                  key={`${event.timestamp}-${event.person_id}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "72px 100px minmax(0,1.6fr) minmax(0,1fr) 80px",
                    alignItems: "center",
                    gap: 10,
                    minHeight: "var(--row-height-dense)",
                    padding: "0 var(--pad-card)",
                    borderBottom: "1px solid var(--grid-line)",
                    fontSize: "var(--size-label)",
                  }}
                >
                  <span style={mono}>{clockTime(event.timestamp)}</span>
                  <Link
                    href={`/people/${event.person_id}`}
                    data-plain
                    style={{ ...mono, textDecoration: "none" }}
                  >
                    {event.person_id.slice(0, 8)}
                  </Link>
                  <span
                    style={{
                      color: "var(--text-body)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {eventLabel(event.name)}
                  </span>
                  <span style={{ ...mono, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {prettyPath(event.path, 30)}
                  </span>
                  <span style={{ ...mono, textAlign: "right" }}>
                    {event.country || "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <BreakdownCard
            title="Pages right now"
            emptyBody="Nobody is on the site at this moment."
            items={paths.slice(0, 8).map(([path, count]) => ({
              label: path,
              value: num(count),
              count,
            }))}
          />

          <BreakdownCard
            title="Countries right now"
            emptyBody="No locations resolved for current visitors."
            items={countries.slice(0, 8).map(([code, count]) => ({
              label: countryLabel(code),
              value: num(count),
              count,
            }))}
          />

          <Card title="Longest on site" subtitle="Current visitors by time in session">
            {visitors.length === 0 ? (
              <Empty dense icon="users" title="Nobody on site" body="No active sessions right now." />
            ) : (
              <div style={{ display: "grid", gap: 1 }}>
                {[...visitors]
                  .sort((a, b) => b.seconds_on_site - a.seconds_on_site)
                  .slice(0, 8)
                  .map((visitor) => (
                    <Link
                      key={visitor.person_id}
                      href={`/people/${visitor.person_id}`}
                      data-plain
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) 56px 72px",
                        alignItems: "center",
                        gap: 10,
                        minHeight: "var(--row-height-dense)",
                        borderBottom: "1px solid var(--grid-line)",
                        textDecoration: "none",
                        fontSize: "var(--size-label)",
                      }}
                    >
                      <span style={{ ...mono, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {prettyPath(visitor.current_path, 24)}
                      </span>
                      <span style={{ ...mono, textAlign: "right" }}>{num(visitor.pageviews)}</span>
                      <span style={{ ...mono, textAlign: "right", color: "var(--text-primary)" }}>
                        {duration(visitor.seconds_on_site)}
                      </span>
                    </Link>
                  ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConnectionState({ status, at }: { status: Status; at?: number }) {
  const tone = status === "live" ? "up" : status === "reconnecting" ? "warn" : "neutral";
  const label =
    status === "live"
      ? at
        ? `live · ${clockTime(new Date(at))}`
        : "live"
      : status === "reconnecting"
        ? "reconnecting"
        : "connecting";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Badge tone={tone} dot>
        {label}
      </Badge>
    </span>
  );
}

function rank<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([, a], [, b]) => b - a);
}

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-micro)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};
