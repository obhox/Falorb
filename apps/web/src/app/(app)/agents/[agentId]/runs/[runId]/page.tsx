import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { getRun } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { money, relative } from "@/lib/format";
import { RunTranscript } from "./RunTranscript";

export const metadata: Metadata = { title: "Shift" };
export const dynamic = "force-dynamic";

/**
 * One shift, in full.
 *
 * The report at the top is what a manager reads; the transcript below is
 * what makes the report checkable. That combination is the whole reason an
 * autonomous agent is something a business can responsibly run on — "the
 * agent updated a deal" is not reviewable, whereas "at step 4 it called
 * `crm_update_contact` with these arguments and got this back" is.
 */
export default async function RunPage({
  params,
}: {
  params: Promise<{ agentId: string; runId: string }>;
}) {
  const { agentId, runId } = await params;
  const session = await requireSession();

  const found = await getRun(session.workspace.organizationId, runId);
  if (!found || found.run.agentId !== agentId) notFound();

  const { run, agent, steps } = found;
  const now = Date.now();

  return (
    <>
      <PageHeader
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span aria-hidden>{agent?.avatar ?? "🤖"}</span>
            <Link
              href={`/agents/${agentId}`}
              data-plain
              style={{ color: "var(--text-primary)", textDecoration: "none" }}
            >
              {agent?.name ?? "Agent"}
            </Link>
          </span>
        }
        meta={`${run.trigger} shift · ${relative(run.createdAt, now)}`}
      />
      <PageBody>
        <div style={{ display: "grid", gap: "var(--space-5)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge
              tone={
                run.status === "succeeded"
                  ? "up"
                  : run.status === "failed"
                    ? "down"
                    : run.status === "waiting_approval"
                      ? "warn"
                      : run.status === "needs_attention"
                        ? "down"
                        : "accent"
              }
            >
              {run.status.replace("_", " ")}
            </Badge>
            <Badge tone="neutral" mono>
              {run.stepCount} steps
            </Badge>
            <Badge tone="neutral" mono>
              {(run.promptTokens + run.completionTokens).toLocaleString()} tokens
            </Badge>
            {Number(run.costUsd) > 0 && (
              <Badge tone="neutral" mono>
                {money(Number(run.costUsd))}
              </Badge>
            )}
          </div>

          <Card title="Objective" tone="inset" padding={14}>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              {run.objective}
            </p>
          </Card>

          {run.summary && (
            <Card title="Report">
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {run.summary}
              </p>
            </Card>
          )}

          {run.error && (
            <Card title="Failure" tone="inset" padding={14}>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-danger, #d66)" }}>
                {run.error}
              </p>
            </Card>
          )}

          <RunTranscript
            steps={steps.map((s) => ({
              id: s.id,
              position: s.position,
              kind: s.kind,
              content: s.content,
              toolName: s.toolName,
              arguments: s.arguments,
              result: s.result,
              ok: s.ok,
              durationMs: s.durationMs,
            }))}
          />
        </div>
      </PageBody>
    </>
  );
}
