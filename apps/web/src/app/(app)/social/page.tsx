import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/server/session";
import { isBufferConnected, listChannels, listPosts } from "@/server/social";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { SocialPanel } from "./SocialPanel";

export const metadata: Metadata = { title: "Social" };
export const dynamic = "force-dynamic";

/**
 * Buffer's channel/post mirror plus a compose card to publish from Falorb.
 * Unlike Linki/Bund AI, posts aren't scoped to one analytics person, so this
 * is its own top-level page rather than a card on `/people/[personId]`.
 */
export default async function SocialPage() {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;

  const connected = await isBufferConnected(orgId);
  if (!connected) {
    return (
      <>
        <PageHeader title="Social" meta={session.workspace.organizationName} />
        <PageBody>
          <Empty
            icon="share-2"
            title="Buffer isn't connected"
            body="Connect it to see your queue and publish posts from here."
            action={
              <Link href="/settings/integrations" style={{ textDecoration: "none" }}>
                Connect in Settings → Integrations
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const [channels, posts] = await Promise.all([listChannels(orgId), listPosts(orgId)]);

  return (
    <>
      <PageHeader
        title="Social"
        meta={`${channels.length} connected channel${channels.length === 1 ? "" : "s"}`}
      />
      <PageBody>
        <SocialPanel
          channels={channels.map((c) => ({
            id: c.id,
            bufferId: c.bufferId,
            service: c.service,
            displayName: c.displayName ?? c.name ?? c.bufferId,
            isDisconnected: c.isDisconnected,
            isQueuePaused: c.isQueuePaused,
            weeklyPostingLimit: c.weeklyPostingLimit,
          }))}
          posts={posts.map((p) => ({
            id: p.id,
            bufferId: p.bufferId,
            channelBufferId: p.channelBufferId,
            text: p.text,
            status: p.status,
            dueAt: p.dueAt?.toISOString() ?? null,
            sentAt: p.sentAt?.toISOString() ?? null,
            errorMessage: p.errorMessage,
            syncedAt: p.syncedAt.toISOString(),
          }))}
          now={Date.now()}
        />
      </PageBody>
    </>
  );
}
