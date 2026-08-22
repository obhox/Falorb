"use client";

import Link from "next/link";
import { Badge, Button, Card } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { publishContentDraft } from "@/server/actions/content-draft";

export function PublishDraftCard({
  slug,
  draftId,
  connected,
  publishStatus,
  publishedUrl,
  publishCommitSha,
  publishError,
}: {
  slug: string;
  draftId: string;
  connected: boolean;
  publishStatus: "draft" | "publishing" | "published" | "failed";
  publishedUrl: string | null;
  publishCommitSha: string | null;
  publishError: string | null;
}) {
  const { run, pending } = useAction();

  if (!connected) {
    return (
      <Card title="Publish">
        <div style={{ display: "grid", gap: 8 }}>
          <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)" }}>
            Connect a GitHub blog repo to commit this draft straight to your site.
          </span>
          <Link
            href={`/p/${slug}/settings`}
            data-plain
            style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)", width: "fit-content" }}
          >
            Connect in Settings →
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Publish">
      <div style={{ display: "grid", gap: 10 }}>
        {publishStatus === "published" && (
          <>
            <Badge tone="up">Published{publishCommitSha ? ` — ${publishCommitSha.slice(0, 7)}` : ""}</Badge>
            {publishedUrl && (
              <Link
                href={publishedUrl}
                target="_blank"
                rel="noreferrer"
                data-plain
                style={{ color: "var(--accent)", fontSize: "var(--size-body-sm)", width: "fit-content" }}
              >
                View on GitHub →
              </Link>
            )}
          </>
        )}

        {publishStatus === "failed" && publishError && (
          <span style={{ fontSize: "var(--size-body-sm)", color: "var(--signal-down)" }}>{publishError}</span>
        )}

        <Button
          size="sm"
          variant="primary"
          disabled={pending}
          onClick={() =>
            void run(() => publishContentDraft(slug, draftId), {
              success: "Published.",
            })
          }
          style={{ justifySelf: "start" }}
        >
          {publishStatus === "published" ? "Re-publish" : publishStatus === "failed" ? "Try again" : "Publish"}
        </Button>
      </div>
    </Card>
  );
}
