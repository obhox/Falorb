import type { Metadata } from "next";
import { Badge, Card } from "@falorb/ui";
import { AUDIT_ACTIONS } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listAuditLog } from "@/server/audit";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { Pager } from "@/components/Pager";
import { dateTime, personLabel } from "@/lib/format";
import { one, type SearchParams } from "@/lib/range";
import { ActionFilter } from "./ActionFilter";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const ACTIONS = Object.values(AUDIT_ACTIONS).sort();

/**
 * Who changed what, and when. Written extensively already (`audit()`,
 * `packages/db/src/audit.ts`) by project, key, member, person, CRM, support
 * and integration actions — this is the first place any of it is readable
 * outside Postgres.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const search = await searchParams;

  const action = one(search, "action") || undefined;
  const page = Math.max(1, Number(one(search, "page")) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { rows, total, hasMore } = await listAuditLog({
    organizationId: session.workspace.organizationId,
    action,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <>
      <PageHeader title="Audit log" meta={session.workspace.organizationName} />
      <PageBody>
        <Card
          title="Activity"
          subtitle={`${total.toLocaleString("en-US")} entries`}
          action={<ActionFilter actions={ACTIONS} value={action ?? ""} />}
        >
          {rows.length === 0 ? (
            <Empty
              dense
              icon="scroll-text"
              title="No activity yet"
              body="Privileged actions — settings changes, key issuance, merges, integration connects — show up here as they happen."
            />
          ) : (
            <div className="falorb-scroll-x">
              <div style={{ display: "grid", gap: 1 }}>
                <div style={head}>
                  <span>When</span>
                  <span>Who</span>
                  <span>Action</span>
                  <span>Target</span>
                </div>
                {rows.map((row) => (
                  <div key={row.id} style={body}>
                    <span style={{ ...cell, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                      {dateTime(row.createdAt)}
                    </span>
                    <span style={cell}>{row.actorName ?? row.actorEmail ?? "system"}</span>
                    <span style={cell}>
                      <Badge tone="neutral" mono>
                        {row.action}
                      </Badge>
                    </span>
                    <span style={{ ...cell, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {row.targetType
                        ? `${row.targetType}:${row.targetType === "person" && row.targetId ? personLabel(row.targetId) : (row.targetId ?? "—")}`
                        : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Pager page={page} hasMore={hasMore} total={total} pageSize={PAGE_SIZE} />
        </Card>
      </PageBody>
    </>
  );
}

const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "170px minmax(0,1fr) minmax(0,1.4fr) minmax(0,1.4fr)",
  gap: 12,
  height: 30,
  alignItems: "center",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--size-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-label)",
  color: "var(--text-muted)",
  fontWeight: "var(--wt-medium)",
};

const body: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "170px minmax(0,1fr) minmax(0,1.4fr) minmax(0,1.4fr)",
  gap: 12,
  minHeight: "var(--row-height)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};

const cell: React.CSSProperties = {
  fontSize: "var(--size-body-sm)",
  color: "var(--text-body)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};
