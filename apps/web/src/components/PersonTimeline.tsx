"use client";

import Link from "next/link";
import { Icon } from "@falorb/ui";
import { clockTime, durationMs, eventLabel, money, relative, shortDate } from "@/lib/format";

/**
 * A person's events, newest first, across every property.
 *
 * Grouped by day with a sticky day marker, because a timeline that crosses
 * products is read as "what happened on Tuesday", not as a flat list of 100
 * rows. The property is named on every row — the whole point of this view is
 * that consecutive rows can belong to different products.
 */

export interface TimelineEvent {
  id: string;
  timestamp: string;
  name: string;
  path: string;
  title: string;
  project: string;
  projectSlug: string | null;
  channel: string;
  country: string;
  device: string;
  durationMs: number;
  revenue: number | null;
}

const ICONS: Record<string, string> = {
  $pageview: "file-text",
  $pageleave: "log-out",
  $identify: "user-check",
  $revenue: "credit-card",
  $error: "triangle-alert",
  $rage_click: "zap",
  $outbound: "external-link",
  $download: "download",
  $form_submit: "send",
  $group: "users",
};

export function PersonTimeline({ events, now }: { events: TimelineEvent[]; now: number }) {
  let lastDay = "";

  return (
    <div className="falorb-scroll-x">
    <div className="falorb-stagger" style={{ display: "grid" }}>
      {events.map((event, index) => {
        const day = shortDate(event.timestamp, now);
        const newDay = day !== lastDay;
        lastDay = day;

        return (
          <div key={event.id} style={{ "--i": Math.min(index, 24) } as React.CSSProperties}>
            {newDay && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px var(--pad-card) 6px",
                  background: "var(--surface-card)",
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
                  {day}
                </span>
                <span style={{ flex: 1, height: 1, background: "var(--grid-line)" }} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                  }}
                >
                  {relative(event.timestamp, now)}
                </span>
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "62px 22px minmax(0, 1.7fr) minmax(0, 1fr) 76px",
                alignItems: "center",
                gap: 10,
                minHeight: "var(--row-height-dense)",
                padding: "0 var(--pad-card)",
                borderBottom: "1px solid var(--grid-line)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontFeatureSettings: "var(--tnum)",
                  fontSize: "var(--size-micro)",
                  color: "var(--text-muted)",
                }}
              >
                {clockTime(event.timestamp)}
              </span>

              <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>
                <Icon name={ICONS[event.name] ?? "circle-dot"} size={13} />
              </span>

              <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "var(--size-body-sm)",
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {event.title || eventLabel(event.name)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--size-micro)",
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {event.path || eventLabel(event.name)}
                </span>
              </span>

              {event.projectSlug ? (
                <Link
                  href={`/p/${event.projectSlug}`}
                  data-plain
                  style={{
                    fontSize: "var(--size-micro)",
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                  }}
                >
                  {event.project}
                </Link>
              ) : (
                <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  {event.project}
                </span>
              )}

              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontFeatureSettings: "var(--tnum)",
                  fontSize: "var(--size-micro)",
                  color: event.revenue ? "var(--signal-up)" : "var(--text-muted)",
                  textAlign: "right",
                }}
              >
                {event.revenue
                  ? money(event.revenue)
                  : event.durationMs > 0
                    ? durationMs(event.durationMs)
                    : "—"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
