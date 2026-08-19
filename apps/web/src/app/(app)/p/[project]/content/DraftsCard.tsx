import Link from "next/link";
import { Card, Icon } from "@falorb/ui";
import { relative } from "@/lib/format";
import type { ContentDraftRow } from "@/server/actions/content-draft";

/** Past AI-drafted pages for this project — what `draftContentPage` has already produced. */
export function DraftsCard({ slug, drafts }: { slug: string; drafts: ContentDraftRow[] }) {
  return (
    <Card title="Drafted pages" subtitle="AI-drafted from the interest graph, ready to review and paste in">
      <div style={{ display: "grid", gap: 1 }}>
        {drafts.map((draft) => (
          <Link
            key={draft.id}
            href={`/p/${slug}/content/drafts/${draft.id}`}
            data-plain
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              alignItems: "center",
              gap: 14,
              padding: "10px 4px",
              textDecoration: "none",
              borderBottom: "1px solid var(--grid-line)",
            }}
          >
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <span
                style={{
                  fontSize: "var(--size-label)",
                  fontWeight: "var(--wt-medium)",
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {draft.title}
              </span>
              <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                {draft.topic}
              </span>
            </div>
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              {relative(draft.generatedAt)}
            </span>
            <Icon name="chevron-right" size={15} />
          </Link>
        ))}
      </div>
    </Card>
  );
}
