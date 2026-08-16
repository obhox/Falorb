"use client";

import Link from "next/link";
import { Badge, DataTable } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { countryLabel, num, relative, shortDate } from "@/lib/format";

/**
 * The people table.
 *
 * Rows are anchors so a person can be opened in a new tab. `now` is passed
 * from the server so "41m ago" is computed against one clock — deriving it in
 * the browser would produce a different string than the server rendered and
 * break hydration.
 */

export interface PersonListItem {
  id: string;
  label: string;
  identified: boolean;
  email: string | null;
  company: string | null;
  country: string | null;
  device: string | null;
  sessions: number;
  events: number;
  leadScore: number;
  firstSeen: string;
  lastSeen: string;
}

export function PeopleTable({
  people,
  now,
  emptyBody,
}: {
  people: PersonListItem[];
  now: number;
  emptyBody: string;
}) {
  return (
    <DataTable
      dense
      columns={[
        {
          key: "label",
          header: "Person",
          width: "minmax(180px, 1.4fr)",
          render: (row: PersonListItem) => (
            <Link
              href={`/people/${row.id}`}
              data-plain
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                minWidth: 0,
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  fontFamily: row.identified ? "var(--font-sans)" : "var(--font-mono)",
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.label}
              </span>
              {row.identified && <Badge tone="accent">Identified</Badge>}
            </Link>
          ),
        },
        {
          key: "company",
          header: "Company",
          width: "minmax(120px, 1fr)",
          render: (row: PersonListItem) => row.company ?? "—",
        },
        {
          key: "country",
          header: "Country",
          width: "120px",
          render: (row: PersonListItem) => countryLabel(row.country),
        },
        {
          key: "device",
          header: "Device",
          width: "90px",
          render: (row: PersonListItem) => row.device || "—",
        },
        {
          key: "sessions",
          header: "Sessions",
          width: "82px",
          align: "right",
          mono: true,
          render: (row: PersonListItem) => num(row.sessions),
        },
        {
          key: "events",
          header: "Events",
          width: "82px",
          align: "right",
          mono: true,
          render: (row: PersonListItem) => num(row.events),
        },
        {
          key: "leadScore",
          header: "Score",
          width: "64px",
          align: "right",
          mono: true,
          render: (row: PersonListItem) => num(row.leadScore),
        },
        {
          key: "firstSeen",
          header: "First seen",
          width: "96px",
          align: "right",
          mono: true,
          render: (row: PersonListItem) => shortDate(row.firstSeen, now),
        },
        {
          key: "lastSeen",
          header: "Last seen",
          width: "96px",
          align: "right",
          mono: true,
          render: (row: PersonListItem) => relative(row.lastSeen, now),
        },
      ]}
      rows={people}
      emptyState={
        <Empty
          icon="user-search"
          title="No people match"
          body={emptyBody}
        />
      }
    />
  );
}
