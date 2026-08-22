import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { listErrors } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { ErrorsLog } from "./ErrorsLog";

export const metadata: Metadata = { title: "Errors" };
export const dynamic = "force-dynamic";

/**
 * Every error any agent has hit while working, in one place (FEATURES.md
 * §19). The capture already existed — a thrown run, a failing tool, a
 * refused action all land as `agent_steps` rows with `ok: false` — this page
 * is the surface that was missing, reading across every agent instead of
 * one run's transcript at a time.
 */
export default async function AgentErrorsPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const errors = await listErrors(orgId);

  return (
    <>
      <PageHeader
        title="Errors"
        meta={errors.length ? `${errors.length} recent` : "nothing logged"}
      />
      <PageBody>
        <ErrorsLog
          errors={errors.map((e) => ({
            id: e.id,
            runId: e.runId,
            agentId: e.agentId,
            agentName: e.agentName,
            agentAvatar: e.agentAvatar,
            kind: e.kind,
            toolName: e.toolName,
            message: e.message,
            objective: e.objective,
            trigger: e.trigger,
            createdAt: e.createdAt.toISOString(),
          }))}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
