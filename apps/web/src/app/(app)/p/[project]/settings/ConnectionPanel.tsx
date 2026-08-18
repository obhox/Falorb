"use client";

import { useState } from "react";
import { Badge, Card, Icon } from "@falorb/ui";
import { relative } from "@/lib/format";
import { DomainTestRows, type DomainStatusView } from "@/components/DomainTest";
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
  /** One entry per configured domain, each independently testable. */
  domains: DomainStatusView[];
}

/**
 * Whether this property is connected, and a way to prove it.
 *
 * The verdict in the header is the property as a whole; the rows below are
 * per domain, because that is the granularity the answer actually has. A
 * property with a marketing site and an app can be half-installed, and rolled
 * up to the property that reads as "connected" — the wrong answer for half the
 * traffic. `DomainTest` owns the test itself; this panel owns the diagnostics
 * around it.
 */
export function ConnectionPanel({
  slug,
  initial,
}: {
  slug: string;
  initial: ConnectionView;
}) {
  const [status, setStatus] = useState(initial);
  const [proved, setProved] = useState(false);
  const [testFailed, setTestFailed] = useState(false);

  const tone =
    proved || status.state === "live"
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
        <DomainTestRows
          slug={slug}
          domains={status.domains}
          onPoll={(poll) => {
            setStatus((prev) => ({ ...prev, ...poll, domains: poll.domains ?? prev.domains }));
            // A domain that reported during a test proves the property is
            // connected, even if the 24-hour window the badge reads has not
            // caught up yet.
            if (poll.domains?.some((d) => d.receivedSinceTest)) setProved(true);
          }}
          // A test that timed out needs the checklist even when the property as
          // a whole is live — a second domain silently missing the snippet is
          // exactly the case the property-level verdict hides.
          onGaveUp={() => setTestFailed(true)}
        />

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

        {(status.state !== "live" || testFailed) && (
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
