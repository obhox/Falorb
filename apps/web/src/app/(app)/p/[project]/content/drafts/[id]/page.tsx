import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Icon, Tag } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { getContentDraft } from "@/server/actions/content-draft";
import { PageBody } from "@/components/shell/PageHeader";
import { CopyField } from "@/components/CopyField";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}): Promise<Metadata> {
  const { project, id } = await params;
  const { project: resolved } = await requireProject(project);
  const draft = await getContentDraft(resolved.slug, id);
  return { title: draft ? `${draft.title} — Draft` : "Draft" };
}

/**
 * One AI-drafted content page — the copy `draftContentPage` produced for a
 * "rising interest, thin coverage" topic. Falorb has no CMS integration, so
 * this is a read-and-copy view: title, meta description, and markdown body,
 * each with its own copy button, meant to be pasted into wherever the page
 * actually gets published.
 */
export default async function ContentDraftPage({
  params,
}: {
  params: Promise<{ project: string; id: string }>;
}) {
  const { project, id } = await params;
  const { project: resolved } = await requireProject(project);
  const draft = await getContentDraft(resolved.slug, id);
  if (!draft) notFound();

  return (
    <PageBody>
      <div style={{ display: "grid", gap: 8 }}>
        <Link
          href={`/p/${resolved.slug}/content`}
          data-plain
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            width: "fit-content",
            fontSize: "var(--size-label)",
            color: "var(--text-secondary)",
            textDecoration: "none",
          }}
        >
          <Icon name="arrow-left" size={13} />
          Content
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2
            style={{
              fontSize: "var(--size-body)",
              fontWeight: "var(--wt-semibold)",
              color: "var(--text-primary)",
            }}
          >
            {draft.title}
          </h2>
          <Tag>{draft.topic}</Tag>
        </div>
        <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
          Generated on {dateTime(draft.generatedAt)}
        </span>
      </div>

      <Card title="Title" subtitle="Under 60 characters, for the page's <title> and heading">
        <CopyField value={draft.title} />
      </Card>

      <Card title="Meta description" subtitle="Under 160 characters, for search results and shares">
        <CopyField value={draft.metaDescription} />
      </Card>

      <Card title="Page body" subtitle="Markdown, ready to paste into your CMS">
        <CopyField value={draft.body} />
      </Card>
    </PageBody>
  );
}
