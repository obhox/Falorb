import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { getConversation, listConversationActivity } from "@/server/support";
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

function tone(status: string | null): "warn" | "neutral" | "up" | "down" {
  return STATUS_TONE[status ?? ""] ?? "neutral";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const conversation = await getConversation(session.workspace.organizationId, (await params).id);
  return { title: conversation?.channel ?? "Conversation" };
}

export default async function SupportConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const orgId = session.workspace.organizationId;

  const conversation = await getConversation(orgId, id);
  if (!conversation) notFound();

  const activity = await listConversationActivity(orgId, id);
  const hasActivity = activity.escalations.length || activity.leads.length || activity.tickets.length;

  return (
    <>
      <PageHeader
        title={conversation.channel ?? "Conversation"}
        meta={conversation.status ?? undefined}
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
            <Card title="Conversation details">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Channel" value={conversation.channel ?? "—"} />
                <Attribute label="Status" value={conversation.status ?? "—"} />
                <Attribute label="Visitor ref" value={conversation.externalUserRef ?? "—"} mono />
                <Attribute label="Started" value={conversation.startedAt ? dateTime(conversation.startedAt) : "—"} />
                <Attribute
                  label="Last activity"
                  value={conversation.lastActivityAt ? dateTime(conversation.lastActivityAt) : "—"}
                />
                <Attribute label="Bund AI id" value={conversation.bundAiId} mono />
              </div>
              <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", marginTop: 12 }}>
                Full transcript isn't mirrored — Bund AI's own dashboard has the message content.
              </p>
            </Card>

            {hasActivity && (
              <Card title="What this conversation turned into">
                <div style={{ display: "grid", gap: 10 }}>
                  {activity.escalations.map((e) => (
                    <Link key={e.id} href={`/support/escalations/${e.id}`} data-plain style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge tone={tone(e.status)}>escalation</Badge>
                      <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{e.reason ?? "View escalation"}</span>
                    </Link>
                  ))}
                  {activity.leads.map((l) => (
                    <Link key={l.id} href={`/support/leads/${l.id}`} data-plain style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge tone={tone(l.status)}>lead</Badge>
                      <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{l.name ?? "View lead"}</span>
                    </Link>
                  ))}
                  {activity.tickets.map((t) => (
                    <Link key={t.id} href={`/support/tickets/${t.id}`} data-plain style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge tone={tone(t.status)}>ticket</Badge>
                      <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>{t.subject ?? "View ticket"}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            {conversation.personId && (
              <Card title="Person">
                <Link href={`/people/${conversation.personId}`} data-plain style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)" }}>
                  View person profile →
                </Link>
              </Card>
            )}
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
