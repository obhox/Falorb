"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Card, DataTable, IconButton, Icon, Tabs } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { resolveEscalationAction } from "@/server/actions/support";
import { relative } from "@/lib/format";

export interface EscalationRow {
  id: string;
  reason: string | null;
  summary: string | null;
  status: string | null;
  customerContact: string | null;
  personId: string | null;
  createdAt: string | null;
}

export interface ConversationRow {
  id: string;
  personId: string | null;
  channel: string | null;
  status: string | null;
  externalUserRef: string | null;
  lastActivityAt: string | null;
}

export interface LeadRow {
  id: string;
  personId: string | null;
  name: string | null;
  email: string | null;
  intent: string | null;
  status: string | null;
  updatedAt: string | null;
}

export interface TicketRow {
  id: string;
  personId: string | null;
  subject: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  updatedAt: string | null;
}

const STATUS_TONE: Record<string, "warn" | "neutral" | "up" | "down"> = {
  open: "warn",
  in_progress: "warn",
  active: "up",
  handoff: "warn",
  resolved: "up",
  closed: "neutral",
};

function PersonLink({ personId }: { personId: string | null }) {
  if (!personId) return <>—</>;
  return (
    <Link href={`/people/${personId}`} data-plain style={{ color: "var(--text-primary)" }}>
      view person
    </Link>
  );
}

export function SupportTabsPanel({
  escalations,
  conversations,
  leads,
  tickets,
  now,
}: {
  escalations: EscalationRow[];
  conversations: ConversationRow[];
  leads: LeadRow[];
  tickets: TicketRow[];
  now: number;
}) {
  const [tab, setTab] = useState("escalations");
  const { run, pending } = useAction();

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "escalations", label: "Escalations", count: escalations.filter((e) => e.status !== "resolved").length },
          { value: "conversations", label: "Conversations", count: conversations.length },
          { value: "leads", label: "Leads", count: leads.length },
          { value: "tickets", label: "Tickets", count: tickets.length },
        ]}
      />

      {tab === "escalations" && (
        <Card title="Escalations" subtitle="Resolve directly — the same act as Bund AI's own dashboard">
          <DataTable
            dense
            columns={[
              {
                key: "status",
                header: "Status",
                width: "90px",
                render: (r: EscalationRow) => <Badge tone={STATUS_TONE[r.status ?? ""] ?? "neutral"}>{r.status ?? "—"}</Badge>,
              },
              { key: "reason", header: "Reason", width: "110px", render: (r: EscalationRow) => r.reason ?? "—" },
              { key: "summary", header: "Summary", width: "minmax(160px, 1.6fr)", render: (r: EscalationRow) => r.summary ?? "—" },
              { key: "customerContact", header: "Contact", width: "minmax(100px, 1fr)", render: (r: EscalationRow) => r.customerContact ?? "—" },
              { key: "person", header: "Person", width: "90px", render: (r: EscalationRow) => <PersonLink personId={r.personId} /> },
              {
                key: "createdAt",
                header: "Opened",
                width: "90px",
                align: "right",
                mono: true,
                render: (r: EscalationRow) => (r.createdAt ? relative(r.createdAt, now) : "—"),
              },
              {
                key: "resolve",
                header: "",
                width: "40px",
                render: (r: EscalationRow) =>
                  r.status !== "resolved" && (
                    <IconButton
                      size="sm"
                      label="Resolve"
                      icon={<Icon name="check" size={13} />}
                      disabled={pending}
                      onClick={() => void run(() => resolveEscalationAction(r.id), { success: "Resolved." })}
                    />
                  ),
              },
            ]}
            rows={escalations}
            emptyState={<Empty dense icon="life-buoy" title="No escalations" body="Nothing has been handed off to a human yet." />}
          />
        </Card>
      )}

      {tab === "conversations" && (
        <Card title="Conversations" subtitle="Bund AI chat sessions">
          <DataTable
            dense
            columns={[
              { key: "channel", header: "Channel", width: "100px", render: (r: ConversationRow) => r.channel ?? "—" },
              { key: "status", header: "Status", width: "100px", render: (r: ConversationRow) => <Badge tone={STATUS_TONE[r.status ?? ""] ?? "neutral"}>{r.status ?? "—"}</Badge> },
              { key: "externalUserRef", header: "Visitor ref", width: "minmax(120px, 1fr)", mono: true, render: (r: ConversationRow) => r.externalUserRef ?? "—" },
              { key: "person", header: "Person", width: "90px", render: (r: ConversationRow) => <PersonLink personId={r.personId} /> },
              {
                key: "lastActivityAt",
                header: "Last activity",
                width: "100px",
                align: "right",
                mono: true,
                render: (r: ConversationRow) => (r.lastActivityAt ? relative(r.lastActivityAt, now) : "—"),
              },
            ]}
            rows={conversations}
            emptyState={<Empty dense icon="message-circle" title="No conversations yet" body="Nothing has synced yet." />}
          />
        </Card>
      )}

      {tab === "leads" && (
        <Card title="Leads" subtitle="Captured mid-conversation by the support agent">
          <DataTable
            dense
            columns={[
              { key: "name", header: "Name", width: "minmax(120px, 1fr)", render: (r: LeadRow) => r.name ?? "—" },
              { key: "email", header: "Email", width: "minmax(140px, 1fr)", render: (r: LeadRow) => r.email ?? "—" },
              { key: "intent", header: "Intent", width: "minmax(140px, 1.4fr)", render: (r: LeadRow) => r.intent ?? "—" },
              { key: "status", header: "Status", width: "100px", render: (r: LeadRow) => <Badge tone={STATUS_TONE[r.status ?? ""] ?? "neutral"}>{r.status ?? "—"}</Badge> },
              { key: "person", header: "Person", width: "90px", render: (r: LeadRow) => <PersonLink personId={r.personId} /> },
              {
                key: "updatedAt",
                header: "Updated",
                width: "90px",
                align: "right",
                mono: true,
                render: (r: LeadRow) => (r.updatedAt ? relative(r.updatedAt, now) : "—"),
              },
            ]}
            rows={leads}
            emptyState={<Empty dense icon="user-plus" title="No leads yet" body="Nothing has synced yet." />}
          />
        </Card>
      )}

      {tab === "tickets" && (
        <Card title="Tickets" subtitle="Support tickets converted from a chat">
          <DataTable
            dense
            columns={[
              { key: "subject", header: "Subject", width: "minmax(160px, 1.6fr)", render: (r: TicketRow) => r.subject ?? "—" },
              { key: "category", header: "Category", width: "100px", render: (r: TicketRow) => r.category ?? "—" },
              {
                key: "priority",
                header: "Priority",
                width: "90px",
                render: (r: TicketRow) => <Badge tone={r.priority === "high" || r.priority === "urgent" ? "down" : "neutral"}>{r.priority ?? "—"}</Badge>,
              },
              { key: "status", header: "Status", width: "100px", render: (r: TicketRow) => <Badge tone={STATUS_TONE[r.status ?? ""] ?? "neutral"}>{r.status ?? "—"}</Badge> },
              { key: "person", header: "Person", width: "90px", render: (r: TicketRow) => <PersonLink personId={r.personId} /> },
              {
                key: "updatedAt",
                header: "Updated",
                width: "90px",
                align: "right",
                mono: true,
                render: (r: TicketRow) => (r.updatedAt ? relative(r.updatedAt, now) : "—"),
              },
            ]}
            rows={tickets}
            emptyState={<Empty dense icon="ticket" title="No tickets yet" body="Nothing has synced yet." />}
          />
        </Card>
      )}
    </div>
  );
}
