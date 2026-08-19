import { requireProject } from "@/server/session";
import { listWaitlistWithPositions, waitlistJoinUrl } from "@/server/waitlist";
import { PageBody } from "@/components/shell/PageHeader";
import { WaitlistPanel } from "./WaitlistPanel";

export const dynamic = "force-dynamic";

/**
 * Owner-facing waitlist management.
 *
 * Enabling mints `projects.waitlistToken`; the public join page it points at
 * is `apps/web/src/app/waitlist/[token]/page.tsx`. Position here is the same
 * live computation an entrant sees on their own join page — never a cached
 * column, per `waitlistEntries`'s own doc comment.
 */
export default async function WaitlistPage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await requireProject((await params).project);

  const enabled = Boolean(project.waitlistToken);
  const joinUrl = project.waitlistToken ? waitlistJoinUrl(project.waitlistToken) : null;
  const entries = enabled ? await listWaitlistWithPositions(project.id) : [];

  return (
    <PageBody>
      <WaitlistPanel
        slug={project.slug}
        enabled={enabled}
        joinUrl={joinUrl}
        entries={entries.map((entry) => ({
          id: entry.id,
          email: entry.email,
          name: entry.name,
          position: entry.position,
          referralCount: entry.referralCount,
          createdAt: entry.createdAt.toISOString(),
        }))}
      />
    </PageBody>
  );
}
