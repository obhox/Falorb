import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/session";
import { getUgcVideo, listPostQueue } from "@/server/ugc-videos";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { UgcVideoDetail } from "./UgcVideoDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const session = await requireSession();
  const video = await getUgcVideo(id, session.workspace.organizationId);
  return { title: video ? video.brief.slice(0, 60) : "UGC video" };
}

export default async function UgcVideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const video = await getUgcVideo(id, session.workspace.organizationId);
  if (!video) notFound();

  const queue = await listPostQueue(id, session.workspace.organizationId);

  return (
    <>
      <PageHeader title="UGC video" meta={video.status} />
      <PageBody>
        <UgcVideoDetail
          video={{
            id: video.id,
            brief: video.brief,
            script: video.script,
            status: video.status,
            lastError: video.lastError,
            videoUrl: video.videoUrl,
            durationSeconds: video.durationSeconds,
          }}
          queue={queue.map((q) => ({
            id: q.id,
            platform: q.platform,
            caption: q.caption,
            scheduledAt: q.scheduledAt?.toISOString() ?? null,
            status: q.status,
            createdAt: q.createdAt.toISOString(),
          }))}
        />
      </PageBody>
    </>
  );
}
