import type { Metadata } from "next";
import { can } from "@falorb/db";
import { requireSession } from "@/server/session";
import { listSegments } from "@/server/segments";
import { FILTERABLE_FIELDS } from "@/server/analytics";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { SegmentsPanel } from "./SegmentsPanel";

export const metadata: Metadata = { title: "Segments" };
export const dynamic = "force-dynamic";

/**
 * Saved segments — reusable person filters built from the condition-tree
 * builder. `cachedCount`/`cachedAt` come from the worker's
 * `refreshSegmentCounts`, not computed on page load.
 */
export default async function SegmentsPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const segments = await listSegments(orgId);

  return (
    <>
      <PageHeader title="Segments" meta={`${segments.length} saved`} />
      <PageBody>
        <SegmentsPanel
          segments={segments}
          projects={session.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug }))}
          fields={FILTERABLE_FIELDS}
          canManage={can.writeAnalysis(session.workspace.role)}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
