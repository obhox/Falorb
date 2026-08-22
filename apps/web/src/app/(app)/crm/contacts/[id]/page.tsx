import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon, Tag } from "@falorb/ui";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { getContact, listMembershipsForContact } from "@/server/crm";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { dateTime, relative } from "@/lib/format";
import { PromoteContactCard } from "./PromoteContactCard";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const contact = await getContact(session.workspace.organizationId, (await params).id);
  return { title: contact?.fullName ?? contact?.email ?? "Contact" };
}

export default async function CrmContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const orgId = session.workspace.organizationId;

  const contact = await getContact(orgId, id);
  if (!contact) notFound();

  const memberships = await listMembershipsForContact(orgId, id);
  const now = Date.now();

  return (
    <>
      <PageHeader
        title={contact.fullName ?? contact.email ?? "Contact"}
        meta={contact.company ?? undefined}
        actions={
          <Link href="/crm/contacts" style={{ textDecoration: "none" }}>
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
              All contacts
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
            <Card title="Contact details">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Full name" value={contact.fullName ?? "—"} />
                <Attribute label="Email" value={contact.email ?? "—"} />
                <Attribute label="Phone" value={contact.phone ?? "—"} />
                <Attribute label="Title" value={contact.title ?? "—"} />
                <Attribute label="Company" value={contact.company ?? "—"} />
                <Attribute label="Location" value={contact.location ?? "—"} />
                {contact.linkedinUrl && (
                  <div style={{ display: "grid", gap: 2 }}>
                    <Label>LinkedIn</Label>
                    <a
                      href={contact.linkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: "var(--size-body-sm)", color: "var(--accent)" }}
                    >
                      {contact.linkedinUrl}
                    </a>
                  </div>
                )}
                <Attribute label="Linki id" value={contact.linkiId} mono />
                <Attribute label="Synced" value={`${relative(contact.syncedAt.toISOString(), now)} · ${dateTime(contact.syncedAt)}`} />
              </div>
            </Card>

            <Card title="Lists" subtitle={`${memberships.length} in Linki`}>
              {memberships.length === 0 ? (
                <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>
                  Not a member of any list.
                </p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {memberships.map((m) => (
                    <Tag key={m.listId}>{m.listName}</Tag>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            {contact.personId ? (
              <Card title="Falorb CRM">
                <div style={{ display: "grid", gap: 10 }}>
                  <Badge tone="up">In the CRM</Badge>
                  <Link href={`/people/${contact.personId}`} data-plain style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)" }}>
                    View person profile →
                  </Link>
                </div>
              </Card>
            ) : (
              <PromoteContactCard contactId={contact.id} canManage={can.manageCrm(session.workspace.role)} />
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: "var(--size-micro)",
        textTransform: "uppercase",
        letterSpacing: "var(--ls-label)",
        color: "var(--text-muted)",
        fontWeight: "var(--wt-medium)",
      }}
    >
      {children}
    </span>
  );
}

function Attribute({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
      <Label>{label}</Label>
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
