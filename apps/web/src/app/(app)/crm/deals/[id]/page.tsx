import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon } from "@falorb/ui";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { ensureDealStages, getDeal } from "@/server/crm";
import { getTeam } from "@/server/team";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { dateTime, money } from "@/lib/format";
import { DealEditCard } from "./DealEditCard";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const deal = await getDeal(session.workspace.organizationId, (await params).id);
  return { title: deal?.name ?? "Deal" };
}

export default async function CrmDealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const orgId = session.workspace.organizationId;

  const deal = await getDeal(orgId, id);
  if (!deal) notFound();

  const [stages, team] = await Promise.all([ensureDealStages(orgId), getTeam(orgId)]);
  const owners = team.members.map((m) => ({ id: m.userId, name: m.name ?? m.email }));

  return (
    <>
      <PageHeader
        title={deal.name}
        meta={deal.stageName ?? undefined}
        actions={
          <Link href="/crm" style={{ textDecoration: "none" }}>
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
              CRM
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
          <DealEditCard
            dealId={deal.id}
            name={deal.name}
            amount={deal.amount}
            currency={deal.currency}
            source={deal.source}
            notes={deal.notes}
            stageId={deal.stageId}
            ownerId={deal.ownerId}
            stages={stages.map((s) => ({ id: s.id, name: s.name }))}
            owners={owners}
            canManage={can.manageCrm(session.workspace.role)}
          />

          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Card title="Summary">
              <div style={{ display: "grid", gap: 10 }}>
                {deal.personId ? (
                  <Link href={`/people/${deal.personId}`} data-plain style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)" }}>
                    {deal.personName ?? deal.personEmail ?? "View person"} →
                  </Link>
                ) : (
                  <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>No linked contact.</p>
                )}
                {(deal.isWon || deal.isLost) && (
                  <Badge tone={deal.isWon ? "up" : "down"}>{deal.isWon ? "Won" : "Lost"}</Badge>
                )}
                <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)" }}>
                  {deal.amount ? money(Number(deal.amount)) : "No amount set"}
                </p>
                <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  Created {dateTime(new Date(deal.createdAt))}
                </p>
                <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                  Updated {dateTime(new Date(deal.updatedAt))}
                </p>
                {deal.closedAt && (
                  <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                    Closed {dateTime(new Date(deal.closedAt))}
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}
