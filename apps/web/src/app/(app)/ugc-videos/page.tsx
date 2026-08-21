import type { Metadata } from "next";
import { requireSession } from "@/server/session";
import { listUgcVideos, listVoiceLibrary } from "@/server/ugc-videos";
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
 *
 * That same connection is what makes the composer's voice picker possible,
 * so the voice library is fetched here alongside the videos rather than
 * from the browser after mount: it needs a decrypted credential, which
 * belongs on the server. `listVoiceLibrary` never throws and never blocks
 * the page — an unreachable ElevenLabs comes back as an empty list and a
 * message, and the composer falls back to a voice-ID field.
 */
export default async function UgcVideosPage() {
  const session = await requireSession();
  const [videos, connections, voiceLibrary] = await Promise.all([
    listUgcVideos(session.workspace.organizationId),
    listConnections(session.workspace.organizationId),
    listVoiceLibrary(session.workspace.organizationId),
  ]);
  const elevenlabsConnected = connections.some((c) => c.provider === "elevenlabs" && c.status === "active");

  return (
    <>
      <PageHeader
        title="UGC videos"
        meta="Talking-avatar ads and text-to-video cuts, generated on your ElevenLabs account"
      />
      <PageBody>
        <UgcVideoList
          elevenlabsConnected={elevenlabsConnected}
          voices={voiceLibrary.voices}
          voiceError={voiceLibrary.error}
          videos={videos.map((v) => ({
            id: v.id,
            projectId: v.projectId,
            projectName: v.projectId
              ? (session.projects.find((p) => p.id === v.projectId)?.name ?? null)
              : null,
            mode: v.mode,
            brief: v.brief,
            voiceName: v.voiceName,
            videoModel: v.videoModel,
            aspectRatio: v.aspectRatio,
            resolution: v.resolution,
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
