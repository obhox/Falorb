import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { getConversation, getTicket } from "@/server/support";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "warn" | "neutral" | "up" | "down"> = {
  open: "warn",
  in_progress: "warn",
  active: "up",
  handoff: "warn",
  resolved: "up",
  closed: "neutral",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const ticket = await getTicket(session.workspace.organizationId, (await params).id);
  return { title: ticket?.subject ?? "Ticket" };
}

export default async function SupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const orgId = session.workspace.organizationId;

  const ticket = await getTicket(orgId, id);
  if (!ticket) notFound();

  const conversation = ticket.conversationId ? await getConversation(orgId, ticket.conversationId) : null;

  return (
    <>
      <PageHeader
        title={ticket.subject ?? "Ticket"}
        meta={ticket.category ?? undefined}
        actions={
          <Link href="/support" style={{ textDecoration: "none" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: "var(--size-label)",
                color: "var(--text-secondary)",
              }}
            >
              <Icon name="arrow-left" size={13} />
              Support
            </span>
          </Link>
        }
      />
      <PageBody>
        <div
          className="falorb-grid-2pane"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(240px, 1fr)",
            gap: "var(--space-6)",
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Card title="Ticket details">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Subject" value={ticket.subject ?? "—"} />
                <Attribute label="Category" value={ticket.category ?? "—"} />
                <Attribute label="Customer" value={ticket.customerName ?? "—"} />
                <Attribute label="Customer contact" value={ticket.customerContact ?? "—"} />
                <Attribute label="Created by" value={ticket.createdBy ?? "—"} />
                <Attribute label="Opened" value={ticket.bundAiCreatedAt ? dateTime(ticket.bundAiCreatedAt) : "—"} />
                <Attribute label="Updated" value={ticket.bundAiUpdatedAt ? dateTime(ticket.bundAiUpdatedAt) : "—"} />
                <Attribute label="Resolved" value={ticket.resolvedAt ? dateTime(ticket.resolvedAt) : "—"} />
                <Attribute label="Bund AI id" value={ticket.bundAiId} mono />
              </div>
            </Card>

            {ticket.description && (
              <Card title="Description">
                <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)", whiteSpace: "pre-wrap" }}>
                  {ticket.description}
                </p>
              </Card>
            )}

            {conversation && (
              <Card title="Originating conversation">
                <div style={{ display: "grid", gap: 10 }}>
                  <Attribute label="Channel" value={conversation.channel ?? "—"} />
                  <Attribute label="Status" value={conversation.status ?? "—"} />
                  <Link
                    href={`/support/conversations/${conversation.id}`}
                    data-plain
                    style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)" }}
                  >
                    View conversation →
                  </Link>
                </div>
              </Card>
            )}
          </div>

          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Card title="Status">
              <div style={{ display: "grid", gap: 10 }}>
                <Badge tone={STATUS_TONE[ticket.status ?? ""] ?? "neutral"}>{ticket.status ?? "—"}</Badge>
                <Badge tone={ticket.priority === "high" || ticket.priority === "urgent" ? "down" : "neutral"}>
                  {ticket.priority ?? "no priority"}
                </Badge>
                {ticket.personId && (
                  <Link href={`/people/${ticket.personId}`} data-plain style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)" }}>
                    View person →
                  </Link>
                )}
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Attribute({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
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
      <span
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: mono ? "var(--size-micro)" : "var(--size-body-sm)",
          color: "var(--text-body)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
