import type { Metadata } from "next";
import { canDecideApproval } from "@falorb/agents";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listActiveGrants, listApprovals } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { ApprovalQueue } from "./ApprovalQueue";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

/**
 * Decisions an agent is waiting on (FEATURES.md §19).
 *
 * `canDecide` is computed per row, not per page, because approving is
 * exercising: a member may wave through a CRM write and still not be allowed
 * to decide something that needs admin. Sending that flag down means the
 * button is absent rather than present-and-then-refused — and the server
 * re-checks it anyway, since a disabled button is a hint, not an
 * authorization decision.
 */
export default async function ApprovalsPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const [pending, recent, grants] = await Promise.all([
    listApprovals(orgId, "pending"),
    listApprovals(orgId, "recent"),
    listActiveGrants(orgId),
  ]);

  const decorate = (rows: Awaited<ReturnType<typeof listApprovals>>) =>
    rows.map((a) => ({
      id: a.id,
      agentId: a.agentId,
      agentName: a.agentName,
      agentAvatar: a.agentAvatar,
      runId: a.runId,
      toolName: a.toolName,
      title: a.title,
      rationale: a.rationale,
      risk: a.risk,
      status: a.status,
      arguments: a.arguments,
      expiresAt: a.expiresAt.toISOString(),
      createdAt: a.createdAt.toISOString(),
      error: a.error,
      decisionNote: a.decisionNote,
      canDecide: canDecideApproval(session.workspace.role, a.requiredCapability),
    }));

  return (
    <>
      <PageHeader
        title="Approvals"
        meta={pending.length ? `${pending.length} waiting on you` : "nothing waiting"}
      />
      <PageBody>
        <ApprovalQueue
          pending={decorate(pending)}
          recent={decorate(recent)}
          grants={grants.map((g) => ({
            id: g.id,
            agentId: g.agentId,
            agentName: g.agentName,
            agentAvatar: g.agentAvatar,
            toolName: g.toolName,
            grantedByName: g.grantedByName,
            expiresAt: g.expiresAt.toISOString(),
          }))}
          canReview={can.reviewAgentWork(session.workspace.role)}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
