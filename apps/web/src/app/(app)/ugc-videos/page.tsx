import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { listUgcVideos } from "@/server/ugc-videos";
import { listConnections } from "@/server/integrations";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { UgcVideoList } from "./UgcVideoList";

export const metadata: Metadata = { title: "UGC videos" };
export const dynamic = "force-dynamic";

/**
 * AI-generated UGC-style video for social posting (FEATURES.md §18).
 *
 * A top-level route rather than a per-project tab, same reasoning as
 * `/prospecting`: this is marketing content for the business, not analysis
 * of one property's traffic. `projectId` on a video is an optional tag for
 * which property/brand it's for.
 *
 * Generation needs the org's own ElevenLabs connection (Settings →
 * Integrations, same model as Linki/Bund AI/Clay) — `elevenlabsConnected`
 * lets the form say so up front rather than accepting a brief that can
 * never advance past `pending`.
 */
export default async function UgcVideosPage() {
  const session = await requireSession();
  const [videos, connections] = await Promise.all([
    listUgcVideos(session.workspace.organizationId),
    listConnections(session.workspace.organizationId),
  ]);
  const elevenlabsConnected = connections.some((c) => c.provider === "elevenlabs" && c.status === "active");

  return (
    <>
      <PageHeader
        title="UGC videos"
        meta="Script, voice, and a lip-synced talking video — generated end to end"
      />
      <PageBody>
        <UgcVideoList
          elevenlabsConnected={elevenlabsConnected}
          videos={videos.map((v) => ({
            id: v.id,
            projectId: v.projectId,
            projectName: v.projectId
              ? (session.projects.find((p) => p.id === v.projectId)?.name ?? null)
              : null,
            brief: v.brief,
            status: v.status,
            lastError: v.lastError,
            videoUrl: v.videoUrl,
            durationSeconds: v.durationSeconds,
            createdAt: v.createdAt.toISOString(),
          }))}
          projects={session.projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </PageBody>
    </>
  );
}
