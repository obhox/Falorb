import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { listProspects } from "@/server/prospects";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { ProspectList, type ProspectView } from "./ProspectList";

export const metadata: Metadata = { title: "Prospecting" };
export const dynamic = "force-dynamic";

/**
 * Everyone worth reaching out to, discovered off-site (Reddit today) rather
 * than on one of the org's own properties — the other half of "who to
 * contact" alongside `/p/[project]/signals`'s on-site hot leads.
 *
 * A top-level route rather than a per-project tab: a prospect is discovered
 * via one project's keyword list, but the useful view is the portfolio-wide
 * list of people to reach out to, the same reasoning `hotLeads`'s
 * "portfolio" scope already established on the Signals page.
 */
export default async function ProspectingPage() {
  const session = await requireSession();
  const prospects = await listProspects({
    organizationId: session.workspace.organizationId,
    limit: 100,
  });

  const projectNames = new Map(session.projects.map((p) => [p.id, p.name]));

  const views: ProspectView[] = prospects.map((p) => ({
    id: p.id,
    projectName: p.projectId ? (projectNames.get(p.projectId) ?? null) : null,
    source: p.source,
    sourceUrl: p.sourceUrl,
    title: p.title,
    excerpt: p.excerpt,
    authorHandle: p.authorHandle,
    matchedKeywords: p.matchedKeywords,
    relevanceScore: p.relevanceScore,
    relevanceRationale: p.relevanceRationale,
    contactName: p.contactName,
    contactEmail: p.contactEmail,
    contactTitle: p.contactTitle,
    status: p.status,
    contactedAt: p.contactedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="Prospecting"
        meta="Discovered from social listening, enriched with contact info"
      />
      <PageBody>
        <ProspectList prospects={views} />
      </PageBody>
    </>
  );
}
