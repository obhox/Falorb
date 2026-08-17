"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Icon } from "@falorb/ui";
import { relative } from "@/lib/format";
import type { ConnectionState } from "@/server/connection";

export interface ConnectionView {
  state: ConnectionState;
  lastEventAt: string | null;
  events24h: number;
  eventsTotal: number;
  collector: {
    reachable: boolean;
    redis: boolean;
    tracker: boolean;
    geoSource: string;
  };
  siteUrl: string | null;
}

/**
 * Whether this property is connected, and a way to prove it.
 *
 * The test is deliberately an observation rather than a simulation. Pressing
 * it does not send a synthetic event — it records the moment, opens the site,
 * and waits for a real event to arrive from a real browser. A synthetic event
 * would prove the dashboard can reach ClickHouse, which was never in doubt;
 * only a real one proves the snippet is on the page, the domain is authorised,
 * and nothing in between is blocking it.
 */
const POLL_MS = 2_000;
const GIVE_UP_MS = 90_000;

export function ConnectionPanel({
  slug,
  initial,
}: {
  slug: string;
  initial: ConnectionView;
}) {
  const [status, setStatus] = useState(initial);
  const [testing, setTesting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!testing) return;

    let cancelled = false;
    const deadline = Date.now() + GIVE_UP_MS;

    const poll = async () => {
      if (cancelled) return;

      try {
        const response = await fetch(
          `/api/p/${encodeURIComponent(slug)}/connection?since=${startedAt.current}`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const body = (await response.json()) as ConnectionView & {
            receivedSinceTest: boolean;
          };
          if (cancelled) return;

          setStatus(body);
          if (body.receivedSinceTest) {
            setConfirmed(true);
            setTesting(false);
            return;
          }
        }
      } catch {
        // A failed poll is not a failed test — the next one may succeed, and
        // the deadline below is what ends this either way.
      }

      if (cancelled) return;
      if (Date.now() > deadline) {
        setTesting(false);
        setGaveUp(true);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };

    let timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [testing, slug]);

  function startTest() {
    startedAt.current = Date.now();
    setConfirmed(false);
    setGaveUp(false);
    setTesting(true);

    // Opening the site is the whole point: an event can only arrive if someone
    // actually loads a page carrying the snippet.
    if (status.siteUrl) window.open(status.siteUrl, "_blank", "noopener");
  }

  const tone =
    confirmed || status.state === "live"
      ? { label: "Connected", badge: "up" as const, icon: "check" }
      : status.state === "silent"
        ? { label: "No recent events", badge: "warn" as const, icon: "pause" }
        : { label: "Waiting for the first event", badge: "neutral" as const, icon: "radio" };

  return (
    <Card
      title="Connection"
      subtitle="Whether this property is sending events, and proof that it is"
      action={
        <Badge tone={tone.badge} dot>
          {tone.label}
        </Badge>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-7)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button
            size="sm"
            variant="primary"
            onClick={startTest}
            disabled={testing || !status.siteUrl}
            iconLeft={<Icon name={testing ? "loader" : "play"} size={13} />}
          >
            {testing ? "Waiting for an event" : "Test connection"}
          </Button>

          {testing && (
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
              Your site opened in a new tab. Load a page there — this updates the moment an event
              arrives.
            </span>
          )}

          {confirmed && (
            <span style={{ fontSize: "var(--size-label)", color: "var(--signal-up)" }}>
              Event received. The snippet is installed and reporting.
            </span>
          )}

          {gaveUp && (
            <span style={{ fontSize: "var(--size-label)", color: "var(--signal-warn)" }}>
              Nothing arrived in 90 seconds. See what to check below.
            </span>
          )}

          {!status.siteUrl && (
            <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
              Add a domain below to enable the test.
            </span>
          )}
        </div>

        <div style={{ display: "grid", gap: 1 }}>
          <Row
            label="Events received"
            value={
              status.eventsTotal === 0
                ? "None yet"
                : `${status.eventsTotal.toLocaleString("en-US")} total · ${status.events24h.toLocaleString("en-US")} in 24h`
            }
            ok={status.eventsTotal > 0}
          />
          <Row
            label="Last event"
            value={status.lastEventAt ? relative(status.lastEventAt) : "Never"}
            ok={status.state === "live"}
          />
          <Row
            label="Collector"
            value={
              status.collector.reachable
                ? status.collector.redis
                  ? "Reachable"
                  : "Reachable, queue unavailable"
                : "Unreachable"
            }
            ok={status.collector.reachable && status.collector.redis}
          />
          <Row
            label="Location data"
            value={
              status.collector.geoSource === "database"
                ? "Country, region and city"
                : status.collector.geoSource === "header"
                  ? "Country only — from your CDN, no database configured"
                  : "Unavailable — country will be empty"
            }
            ok={status.collector.geoSource !== "none"}
          />
        </div>

        {(status.state !== "live" || gaveUp) && (
          <div
            style={{
              display: "grid",
              gap: 6,
              padding: "var(--space-5) var(--space-6)",
              borderRadius: "var(--radius-3)",
              background: "var(--surface-inset)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                fontSize: "var(--size-micro)",
                textTransform: "uppercase",
                letterSpacing: "var(--ls-label)",
                color: "var(--text-muted)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              If nothing arrives
            </span>
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.1em",
                display: "grid",
                gap: 4,
                fontSize: "var(--size-micro)",
                color: "var(--text-body)",
                lineHeight: "var(--lh-normal)",
              }}
            >
              <li>
                The snippet must be in <code>&lt;head&gt;</code> on the page you loaded, not only
                on the homepage.
              </li>
              <li>
                The domain you visited must be listed below. Events from any other origin are
                rejected at the edge — a staging or <code>www.</code> host counts as different
                unless the apex is listed.
              </li>
              <li>
                An ad-blocker on your own browser will stop the request. Try a private window, or
                a device without one.
              </li>
              <li>
                Events are batched: up to 10 events or 2 seconds, and always on page hide. Loading
                a page and leaving it open can delay the first send.
              </li>
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "150px minmax(0, 1fr) 18px",
        gap: 12,
        alignItems: "center",
        minHeight: "var(--row-height-dense)",
        borderBottom: "1px solid var(--grid-line)",
      }}
    >
      <span
        style={{
          fontSize: "var(--size-micro)",
          textTransform: "uppercase",
          letterSpacing: "var(--ls-label)",
          color: "var(--text-muted)",
          fontWeight: "var(--wt-medium)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "var(--size-label)", color: "var(--text-body)" }}>{value}</span>
      <span
        style={{ display: "inline-flex", color: ok ? "var(--signal-up)" : "var(--text-muted)" }}
      >
        <Icon name={ok ? "check" : "minus"} size={12} />
      </span>
    </div>
  );
}
