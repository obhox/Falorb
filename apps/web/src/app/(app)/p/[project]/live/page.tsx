import { requireProject } from "@/server/session";
import { PageBody } from "@/components/shell/PageHeader";
import { LiveView } from "@/components/LiveView";

export const dynamic = "force-dynamic";

/**
 * The realtime view.
 *
 * Everything here streams, so the server renders only the shell and lets the
 * client open the SSE connection. Fetching an initial snapshot on the server
 * would show a figure that is already stale by the time it paints, and the
 * first tick arrives within a few hundred milliseconds anyway.
 */
export default async function LivePage({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await requireProject((await params).project);

  return (
    <PageBody>
      <LiveView slug={project.slug} />
    </PageBody>
  );
}
