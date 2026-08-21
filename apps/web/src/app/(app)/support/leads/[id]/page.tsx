import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { getConversation, getLead } from "@/server/support";
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
  const lead = await getLead(session.workspace.organizationId, (await params).id);
  return { title: lead?.name ?? lead?.email ?? "Lead" };
}

export default async function SupportLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const orgId = session.workspace.organizationId;

  const lead = await getLead(orgId, id);
  if (!lead) notFound();

  const conversation = lead.conversationId ? await getConversation(orgId, lead.conversationId) : null;

  return (
    <>
      <PageHeader
        title={lead.name ?? lead.email ?? "Lead"}
        meta={lead.intent ?? undefined}
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
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(240px, 1fr)",
            gap: "var(--space-6)",
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Card title="Lead details">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Name" value={lead.name ?? "—"} />
                <Attribute label="Email" value={lead.email ?? "—"} />
                <Attribute label="Phone" value={lead.phone ?? "—"} />
                <Attribute label="Intent" value={lead.intent ?? "—"} />
                <Attribute label="Captured" value={lead.bundAiCreatedAt ? dateTime(lead.bundAiCreatedAt) : "—"} />
                <Attribute label="Updated" value={lead.bundAiUpdatedAt ? dateTime(lead.bundAiUpdatedAt) : "—"} />
                <Attribute label="Bund AI id" value={lead.bundAiId} mono />
              </div>
            </Card>

            {lead.notes && (
              <Card title="Notes">
                <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)", whiteSpace: "pre-wrap" }}>{lead.notes}</p>
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
                <Badge tone={STATUS_TONE[lead.status ?? ""] ?? "neutral"}>{lead.status ?? "—"}</Badge>
                {lead.personId && (
                  <Link href={`/people/${lead.personId}`} data-plain style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)" }}>
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
