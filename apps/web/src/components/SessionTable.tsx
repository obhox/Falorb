"use client";

import Link from "next/link";
import { Badge, DataTable } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { countryLabel, duration, num, prettyPath, relative } from "@/lib/format";

/**
 * A list of sessions.
 *
 * The person is a link out to their profile, because the reason to look at a
 * session list is almost always to find one person and then read everything
 * about them.
 */

export interface SessionListItem {
  id: string;
  personId: string;
  startedAt: string;
  durationSec: number;
  pageviews: number;
  events: number;
  entryPath: string;
  exitPath: string;
  channel: string;
  country: string;
  device: string;
  browser: string;
  isBounce: boolean;
}

export function SessionTable({
  sessions,
  now,
}: {
  sessions: SessionListItem[];
  now: number;
}) {
  return (
    <DataTable
      dense
      columns={[
        {
          key: "startedAt",
          header: "Started",
          width: "96px",
          mono: true,
          render: (row: SessionListItem) => relative(row.startedAt, now),
        },
        {
          key: "personId",
          header: "Person",
          width: "110px",
          render: (row: SessionListItem) => (
            <Link
              href={`/people/${row.personId}`}
              data-plain
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--size-micro)",
                textDecoration: "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.personId.slice(0, 8)}
            </Link>
          ),
        },
        {
          key: "entryPath",
          header: "Entry",
          width: "minmax(0, 1.2fr)",
          mono: true,
          render: (row: SessionListItem) => prettyPath(row.entryPath, 34),
        },
        {
          key: "exitPath",
          header: "Exit",
          width: "minmax(0, 1.2fr)",
          mono: true,
          render: (row: SessionListItem) => prettyPath(row.exitPath, 34),
        },
        {
          key: "channel",
          header: "Channel",
          width: "100px",
          render: (row: SessionListItem) => row.channel || "Direct",
        },
        {
          key: "country",
          header: "Country",
          width: "110px",
          render: (row: SessionListItem) => countryLabel(row.country),
        },
        {
          key: "device",
          header: "Device",
          width: "86px",
          render: (row: SessionListItem) => row.device || "—",
        },
        {
          key: "pageviews",
          header: "Views",
          width: "62px",
          align: "right",
          mono: true,
          render: (row: SessionListItem) => num(row.pageviews),
        },
        {
          key: "durationSec",
          header: "Duration",
          width: "84px",
          align: "right",
          mono: true,
          render: (row: SessionListItem) =>
            row.isBounce ? <Badge tone="neutral">Bounce</Badge> : duration(row.durationSec),
        },
      ]}
      rows={sessions}
      emptyState={
        <Empty
          icon="clock"
          title="No sessions recorded"
          body="Nothing matched in this range. Widen it, or clear the event filter."
        />
      }
    />
  );
}
