import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { getRunDetail } from "@/server/crm";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { relative } from "@/lib/format";
import { RunTracksTable } from "./RunTracksTable";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const detail = await getRunDetail(session.workspace.organizationId, (await params).id);
  return { title: detail?.run.workflowName ?? "Run" };
}

const STATE_TONE: Record<string, "up" | "down" | "warn" | "neutral"> = {
  completed: "up",
  sent: "up",
  replied: "up",
  failed: "down",
  error: "down",
  bounced: "down",
  pending: "warn",
  in_progress: "warn",
};

function toneFor(value: string | null): "up" | "down" | "warn" | "neutral" {
  if (!value) return "neutral";
  return STATE_TONE[value.toLowerCase()] ?? "neutral";
}

export default async function CrmRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const detail = await getRunDetail(session.workspace.organizationId, id);
  if (!detail) notFound();

  const { run, tracks } = detail;
  const now = Date.now();

  return (
    <>
      <PageHeader
        title={run.workflowName ?? "Run"}
        meta={run.listName ? `List: ${run.listName}` : undefined}
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
        <Card title="Run">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 16 }}>
            <Field label="Status">
              <Badge tone={toneFor(run.status)}>{run.status ?? "—"}</Badge>
            </Field>
            <Field label="Targets">{run.trackCount}</Field>
            <Field label="Started">{run.startedAt ? relative(run.startedAt, now) : "—"}</Field>
            <Field label="Completed">{run.completedAt ? relative(run.completedAt, now) : "—"}</Field>
          </div>
        </Card>

        <Card title="Targets" subtitle={`${tracks.length} channel tracks`}>
          <RunTracksTable tracks={tracks} now={now} />
        </Card>
      </PageBody>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
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
      <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)" }}>{children}</span>
    </div>
  );
}
