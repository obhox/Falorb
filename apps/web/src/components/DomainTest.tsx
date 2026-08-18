"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Icon } from "@falorb/ui";
import { normaliseHost } from "@/lib/domain-match";
import { relative } from "@/lib/format";

/**
 * Testing one domain at a time.
 *
 * A property is not one site. `evyos.com` and `app.evyos.com` are separate
 * deployments with separate templates, and a configured apex authorises every
 * subdomain beneath it — so the property-wide test could pass on a pageview
 * from the marketing site while the app carried no snippet at all. Every
 * domain gets its own button, and its own verdict.
 *
 * The test is an observation, not a simulation. Pressing it does not send a
 * synthetic event: it records the moment, opens that domain, and waits for a
 * real event to arrive from a real browser. A synthetic event would prove the
 * dashboard can reach ClickHouse, which was never in doubt; only a real one
 * proves the snippet is on the page, *that* domain is authorised, and nothing
 * in between is blocking it.
 */

export type DomainState = "waiting" | "live" | "silent";

export interface DomainStatusView {
  domain: string;
  state: DomainState;
  lastEventAt: string | null;
  events24h: number;
  eventsTotal: number;
  /** Hosts that reported under this domain — more than one means subdomains. */
  hosts: string[];
}

const POLL_MS = 2_000;
const GIVE_UP_MS = 90_000;

export interface CollectorView {
  reachable: boolean;
  redis: boolean;
  tracker: boolean;
  geoSource: string;
}

/** What `/api/p/[project]/connection` answers with. */
export interface ConnectionPoll {
  state: DomainState;
  lastEventAt: string | null;
  events24h: number;
  eventsTotal: number;
  collector: CollectorView;
  domains?: Array<DomainStatusView & { receivedSinceTest: boolean }>;
}

/** Whether two status lists say the same thing, for the guard above. */
function sameStatuses(a: DomainStatusView[], b: DomainStatusView[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((left, i) => {
    const right = b[i]!;
    return (
      left.domain === right.domain &&
      left.state === right.state &&
      left.lastEventAt === right.lastEventAt &&
      left.events24h === right.events24h &&
      left.eventsTotal === right.eventsTotal &&
      left.hosts.length === right.hosts.length
    );
  });
}

interface TestController {
  domains: DomainStatusView[];
  /** The domain currently being tested, or null. One at a time by design. */
  testing: string | null;
  confirmed: Set<string>;
  gaveUp: Set<string>;
  start: (domain: string) => void;
}

export function useDomainTest(
  slug: string,
  initial: DomainStatusView[],
  /**
   * Every poll, so a caller showing the property-level signals alongside these
   * rows can refresh them from the same request rather than a second one.
   */
  onPoll?: (poll: ConnectionPoll) => void,
  /** A test that ran out of time — the caller may want to explain why. */
  onGaveUp?: (domain: string) => void,
): TestController {
  const [domains, setDomains] = useState(initial);
  const [testing, setTesting] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [gaveUp, setGaveUp] = useState<Set<string>>(new Set());
  const startedAt = useRef(0);

  // Held in a ref so a caller passing an inline function does not restart the
  // poll — and therefore the 90-second deadline — on every render.
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;
  const onGaveUpRef = useRef(onGaveUp);
  onGaveUpRef.current = onGaveUp;

  // The server re-renders this list on navigation and after the domains field
  // is saved; without this the panel would keep showing the statuses from the
  // first paint, including for a domain that has just been added.
  //
  // Compared by value, not identity: a caller that builds the array inline
  // would otherwise hand over a new one on every render, and adopting it would
  // schedule the render that produces the next one. Returning `prev` bails out
  // of that before it starts.
  useEffect(() => {
    if (testing) return;
    setDomains((prev) => (sameStatuses(prev, initial) ? prev : initial));
  }, [initial, testing]);

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
          const body = (await response.json()) as ConnectionPoll;
          if (cancelled) return;

          onPollRef.current?.(body);

          if (body.domains?.length) {
            setDomains(body.domains);
            // Only this domain's own arrival ends this test. An event from a
            // sibling domain is not evidence about the one being tested.
            if (body.domains.find((d) => d.domain === testing)?.receivedSinceTest) {
              setConfirmed((prev) => new Set(prev).add(testing));
              setTesting(null);
              return;
            }
          }
        }
      } catch {
        // A failed poll is not a failed test — the next one may succeed, and
        // the deadline below is what ends this either way.
      }

      if (cancelled) return;
      if (Date.now() > deadline) {
        setGaveUp((prev) => new Set(prev).add(testing));
        setTesting(null);
        onGaveUpRef.current?.(testing);
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

  const start = useCallback((domain: string) => {
    startedAt.current = Date.now();
    setConfirmed((prev) => {
      const next = new Set(prev);
      next.delete(domain);
      return next;
    });
    setGaveUp((prev) => {
      const next = new Set(prev);
      next.delete(domain);
      return next;
    });
    setTesting(domain);

    // Opening the site is the whole point: an event can only arrive if someone
    // actually loads a page carrying the snippet.
    window.open(`https://${domain}`, "_blank", "noopener");
  }, []);

  return { domains, testing, confirmed, gaveUp, start };
}

function toneFor(status: DomainStatusView, confirmed: boolean) {
  if (confirmed || status.state === "live") {
    return { label: "Connected", tone: "up" as const };
  }
  if (status.state === "silent") return { label: "No recent events", tone: "warn" as const };
  return { label: "Waiting", tone: "neutral" as const };
}

/**
 * The full list, for the property settings panel.
 *
 * One row per configured domain: what it is, whether it is reporting, when it
 * last did, and a button to prove it right now.
 */
export function DomainTestRows({
  slug,
  domains: initial,
  onPoll,
  onGaveUp,
}: {
  slug: string;
  domains: DomainStatusView[];
  onPoll?: (poll: ConnectionPoll) => void;
  onGaveUp?: (domain: string) => void;
}) {
  const { domains, testing, confirmed, gaveUp, start } = useDomainTest(
    slug,
    initial,
    onPoll,
    onGaveUp,
  );

  if (!domains.length) {
    return (
      <p style={{ fontSize: "var(--size-label)", color: "var(--text-muted)", margin: 0 }}>
        Add a domain below to enable the test. Without one there is nowhere to send you, and
        events from any origin would be rejected at the edge anyway.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 1 }}>
      {domains.map((status) => {
        const tone = toneFor(status, confirmed.has(status.domain));
        const busy = testing === status.domain;
        const subdomains = status.hosts.filter(
          (host) => normaliseHost(host) !== normaliseHost(status.domain),
        );

        return (
          <div
            key={status.domain}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 150px 110px 128px",
              gap: 12,
              alignItems: "center",
              minHeight: "var(--row-height)",
              borderBottom: "1px solid var(--grid-line)",
            }}
          >
            <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--size-label)",
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {status.domain}
              </span>
              {/* Named explicitly, because an apex that authorises subdomains
                  reports their traffic as its own — and "connected" here can
                  mean a host the reader never listed. */}
              {subdomains.length > 0 && (
                <span
                  style={{
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  incl. {subdomains.slice(0, 3).join(", ")}
                  {subdomains.length > 3 ? ` +${subdomains.length - 3}` : ""}
                </span>
              )}
            </span>

            <span>
              <Badge tone={tone.tone} dot>
                {tone.label}
              </Badge>
            </span>

            <span
              style={{
                fontSize: "var(--size-micro)",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {status.lastEventAt ? relative(status.lastEventAt) : "never"}
            </span>

            <span style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                size="sm"
                variant={status.state === "live" ? "secondary" : "primary"}
                onClick={() => start(status.domain)}
                disabled={testing !== null}
                iconLeft={<Icon name={busy ? "loader" : "play"} size={13} />}
              >
                {busy ? "Waiting" : "Test"}
              </Button>
            </span>

            {(busy || confirmed.has(status.domain) || gaveUp.has(status.domain)) && (
              <span
                style={{
                  gridColumn: "1 / -1",
                  fontSize: "var(--size-micro)",
                  paddingBottom: 8,
                  color: busy
                    ? "var(--text-muted)"
                    : confirmed.has(status.domain)
                      ? "var(--signal-up)"
                      : "var(--signal-warn)",
                }}
              >
                {busy
                  ? `${status.domain} opened in a new tab. Load a page there — this updates the moment an event arrives.`
                  : confirmed.has(status.domain)
                    ? "Event received. The snippet is installed on this domain and reporting."
                    : "Nothing arrived from this domain in 90 seconds. See what to check below."}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The compact variant, for the workspace list where a property is one row.
 *
 * Same machinery, no table: a button per domain, and the verdict as a colour
 * rather than a sentence. The workspace page is a scan of ten properties, so
 * anything longer than a chip would drown it.
 */
export function DomainTestChips({
  slug,
  domains: initial,
}: {
  slug: string;
  domains: DomainStatusView[];
}) {
  const { domains, testing, confirmed, gaveUp, start } = useDomainTest(slug, initial);

  if (!domains.length) {
    return (
      <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
        none set — events are rejected
      </span>
    );
  }

  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {domains.map((status) => {
        const busy = testing === status.domain;
        const ok = confirmed.has(status.domain) || status.state === "live";
        const failed = gaveUp.has(status.domain);
        const colour = busy
          ? "var(--text-muted)"
          : ok
            ? "var(--signal-up)"
            : failed || status.state === "silent"
              ? "var(--signal-warn)"
              : "var(--text-muted)";

        return (
          <button
            key={status.domain}
            type="button"
            onClick={(event) => {
              // The row behind this is a link to the property. A test is not a
              // navigation, so it must not become one.
              event.preventDefault();
              event.stopPropagation();
              start(status.domain);
            }}
            disabled={testing !== null}
            title={
              busy
                ? `Waiting for an event from ${status.domain}`
                : `Test the connection for ${status.domain}`
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 22,
              padding: "0 7px",
              borderRadius: "var(--radius-2)",
              background: "var(--control-bg)",
              border: "1px solid var(--control-border)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--size-micro)",
              cursor: testing !== null ? "default" : "pointer",
              opacity: testing !== null && !busy ? 0.6 : 1,
            }}
          >
            <span style={{ display: "inline-flex", color: colour }}>
              <Icon name={busy ? "loader" : ok ? "check" : "play"} size={11} />
            </span>
            {status.domain}
          </button>
        );
      })}
    </span>
  );
}
