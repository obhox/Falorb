import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Icon } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { getEscalation, getConversation } from "@/server/support";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { dateTime } from "@/lib/format";
import { EscalationSummaryCard } from "./EscalationSummaryCard";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const escalation = await getEscalation(session.workspace.organizationId, (await params).id);
  return { title: escalation?.summary ?? escalation?.reason ?? "Escalation" };
}

export default async function SupportEscalationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const orgId = session.workspace.organizationId;

  const escalation = await getEscalation(orgId, id);
  if (!escalation) notFound();

  const conversation = escalation.conversationId ? await getConversation(orgId, escalation.conversationId) : null;

  return (
    <>
      <PageHeader
        title={escalation.summary ?? escalation.reason ?? "Escalation"}
        meta={escalation.reason ?? undefined}
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
            <Card title="Escalation details">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Reason" value={escalation.reason ?? "—"} />
                <Attribute label="Summary" value={escalation.summary ?? "—"} />
                <Attribute label="Customer contact" value={escalation.customerContact ?? "—"} />
                <Attribute label="Opened" value={escalation.bundAiCreatedAt ? dateTime(escalation.bundAiCreatedAt) : "—"} />
                <Attribute label="Resolved" value={escalation.resolvedAt ? dateTime(escalation.resolvedAt) : "—"} />
                <Attribute label="Bund AI id" value={escalation.bundAiId} mono />
              </div>
            </Card>

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
            <EscalationSummaryCard
              escalationId={escalation.id}
              status={escalation.status}
              personId={escalation.personId}
            />
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
