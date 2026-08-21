"use client";

import Link from "next/link";
import { Badge, DataTable } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { relative } from "@/lib/format";

export interface ContactListItem {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  personId: string | null;
  syncedAt: string;
}

export function ContactsTable({
  contacts,
  now,
  emptyBody,
}: {
  contacts: ContactListItem[];
  now: number;
  emptyBody: string;
}) {
  return (
    <DataTable
      dense
      columns={[
        {
          key: "name",
          header: "Name",
          width: "minmax(160px, 1.2fr)",
          render: (r: ContactListItem) => (
            <Link href={`/crm/contacts/${r.id}`} data-plain style={{ color: "var(--text-primary)" }}>
              {r.fullName ?? r.email ?? "—"}
            </Link>
          ),
        },
        { key: "email", header: "Email", width: "minmax(160px, 1fr)", render: (r: ContactListItem) => r.email ?? "—" },
        { key: "company", header: "Company", width: "minmax(140px, 1fr)", render: (r: ContactListItem) => r.company ?? "—" },
        { key: "title", header: "Title", width: "minmax(120px, 1fr)", render: (r: ContactListItem) => r.title ?? "—" },
        {
          key: "crm",
          header: "In CRM",
          width: "90px",
          render: (r: ContactListItem) =>
            r.personId ? <Badge tone="up">yes</Badge> : <Badge tone="neutral">no</Badge>,
        },
        {
          key: "syncedAt",
          header: "Synced",
          width: "90px",
          align: "right",
          mono: true,
          render: (r: ContactListItem) => relative(r.syncedAt, now),
        },
      ]}
      rows={contacts}
      emptyState={<Empty dense icon="users" title="No contacts" body={emptyBody} />}
    />
  );
}
