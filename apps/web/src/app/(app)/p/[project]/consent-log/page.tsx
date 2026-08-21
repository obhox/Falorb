import type { Metadata } from "next";
import { Badge, Card } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { listConsentRecords } from "@/server/consent";
import { PageBody } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { Pager } from "@/components/Pager";
import { dateTime } from "@/lib/format";
import { one, type SearchParams } from "@/lib/range";
import { ConsentFilter } from "./ConsentFilter";

export const metadata: Metadata = { title: "Consent log" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The lawful-basis paper trail: every consent decision the tracker's
 * `consent()` call recorded for this property, since consent enforcement is
 * a server-side gate on ingest (see FEATURES.md §3), not just a client
 * banner — this is what proves it happened.
 */
export default async function ConsentLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { project } = await requireProject((await params).project);
  const search = await searchParams;

  const grantedParam = one(search, "granted");
  const granted = grantedParam === "yes" ? true : grantedParam === "no" ? false : undefined;
  const page = Math.max(1, Number(one(search, "page")) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { rows, total, hasMore } = await listConsentRecords({
    projectId: project.id,
    granted,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <PageBody>
      <Card
        title="Consent log"
        subtitle={`${total.toLocaleString("en-US")} decisions recorded`}
        action={<ConsentFilter value={grantedParam ?? ""} />}
      >
        {rows.length === 0 ? (
          <Empty
            icon="shield-check"
            title="No consent decisions yet"
            body="Nothing recorded — this property may not be in opt-in/opt-out consent mode, or no visitor has answered the prompt yet."
          />
        ) : (
          <div className="falorb-scroll-x">
            <div style={{ display: "grid", gap: 1 }}>
              <div style={head}>
                <span>Recorded</span>
                <span>Visitor</span>
                <span>Decision</span>
                <span>Policy version</span>
              </div>
              {rows.map((r) => (
                <div key={r.id} style={body}>
                  <span style={{ ...cell, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {dateTime(r.recordedAt)}
                  </span>
                  <span style={{ ...cell, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    {r.distinctId}
                  </span>
                  <span style={cell}>
                    <Badge tone={r.granted ? "up" : "down"}>{r.granted ? "granted" : "denied"}</Badge>
                  </span>
                  <span style={{ ...cell, color: "var(--text-muted)" }}>{r.policyVersion ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Pager page={page} hasMore={hasMore} total={total} pageSize={PAGE_SIZE} />
      </Card>
    </PageBody>
  );
}

const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "170px minmax(0,1.4fr) 110px minmax(0,1fr)",
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
  gridTemplateColumns: "170px minmax(0,1.4fr) 110px minmax(0,1fr)",
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
