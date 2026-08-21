import type { Metadata } from "next";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listWebhooks } from "@/server/webhooks";
import { listGoals } from "@/server/goals";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { WebhooksPanel, type WebhookView } from "./WebhooksPanel";

export const metadata: Metadata = { title: "Webhooks" };
export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const [webhooks, goalLists] = await Promise.all([
    listWebhooks(orgId),
    Promise.all(session.projects.map((p) => listGoals(p.id).then((goals) => [p.slug, goals] as const))),
  ]);

  const projectsById = new Map(session.projects.map((p) => [p.id, p]));
  const goalsByProject: Record<string, string[]> = {};
  for (const [slug, goals] of goalLists) {
    goalsByProject[slug] = goals.filter((g) => g.active).map((g) => g.name);
  }

  const views: WebhookView[] = webhooks.map((hook) => {
    const project = hook.projectId ? projectsById.get(hook.projectId) : undefined;
    return {
      id: hook.id,
      projectSlug: project?.slug ?? null,
      projectName: project?.name ?? null,
      url: hook.url,
      triggers: hook.triggers,
      secretPreview: hook.secretPreview,
      active: hook.active,
      failureCount: hook.failureCount,
      lastDeliveryAt: hook.lastDeliveryAt?.toISOString() ?? null,
      createdAt: hook.createdAt.toISOString(),
    };
  });

  return (
    <>
      <PageHeader title="Webhooks" meta={session.workspace.organizationName} />
      <PageBody>
        <WebhooksPanel
          webhooks={views}
          projects={session.projects.map((p) => ({ slug: p.slug, name: p.name }))}
          goalsByProject={goalsByProject}
          canManage={can.manageProject(session.workspace.role)}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
