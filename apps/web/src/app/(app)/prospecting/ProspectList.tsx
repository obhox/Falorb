"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Icon, Switch } from "@falorb/ui";
import { describeProspectSource, labelProspectSource } from "@falorb/core";
import { Empty } from "@/components/Empty";
import { CopyField } from "@/components/CopyField";
import { useToast } from "@/components/Toast";
import { markProspectContacted, dismissProspect, draftProspectOutreach } from "@/server/actions/prospects";
import { useAction } from "@/lib/use-action";
import { relative, shortDate } from "@/lib/format";

export interface ProspectView {
  id: string;
  projectName: string | null;
  source: string;
  sourceUrl: string;
  title: string | null;
  excerpt: string;
  authorHandle: string | null;
  matchedKeywords: string[];
  relevanceScore: number | null;
  relevanceRationale: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactTitle: string | null;
  status: string;
  contactedAt: string | null;
  createdAt: string;
}

/**
 * Everyone worth reaching out to, discovered off-site. Org-wide by design —
 * see `apps/web/src/app/(app)/prospecting/page.tsx` for why this is a
 * top-level route rather than a per-project tab.
 */
export function ProspectList({ prospects }: { prospects: ProspectView[] }) {
  const [showDismissed, setShowDismissed] = useState(false);

  const visible = useMemo(
    () => prospects.filter((p) => showDismissed || p.status !== "dismissed"),
    [prospects, showDismissed],
  );

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {prospects.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Switch checked={showDismissed} onChange={setShowDismissed} label="Show dismissed" />
        </div>
      )}

      {visible.length === 0 ? (
        <Empty
          icon="radar"
          title="No prospects yet"
          body="Add a listening keyword on a property's settings page — matches from Reddit, Hacker News, and job postings show up here, enriched with contact info once Clay is connected on Settings → Integrations."
        />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {visible.map((prospect) => (
            <ProspectRow key={prospect.id} prospect={prospect} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProspectRow({ prospect }: { prospect: ProspectView }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const contacted = prospect.status === "contacted";
  const dismissed = prospect.status === "dismissed";

  async function toggleContacted() {
    await run(() => markProspectContacted(prospect.id, !contacted), {
      success: contacted ? "Marked as not contacted" : "Marked as contacted",
    });
  }

  async function dismiss() {
    await run(() => dismissProspect(prospect.id), { success: "Dismissed" });
  }

  async function draftMessage() {
    setDrafting(true);
    try {
      const result = await draftProspectOutreach(prospect.id);
      if (!result.ok) {
        toast.error(result.message ?? "Could not draft a message.");
        return;
      }
      setDraft(result.message);
    } catch {
      toast.error("The server could not be reached. Check your connection and try again.");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "var(--space-3)",
        padding: "var(--space-4)",
        borderRadius: "var(--radius-3)",
        border: "1px solid var(--border-subtle)",
        opacity: dismissed ? 0.6 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "grid", gap: 4, minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <a
              href={prospect.sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: "var(--size-body-sm)",
                fontWeight: "var(--wt-medium)",
                color: "var(--text-primary)",
                textDecoration: "none",
              }}
            >
              {prospect.title ?? prospect.sourceUrl}
            </a>
            <span title={describeProspectSource(prospect.source)}>
              <Badge tone="neutral">{labelProspectSource(prospect.source)}</Badge>
            </span>
            {prospect.relevanceScore != null && (
              <Badge tone="accent" mono>
                {prospect.relevanceScore}
              </Badge>
            )}
            {prospect.projectName && <Badge tone="neutral">{prospect.projectName}</Badge>}
          </div>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            {prospect.authorHandle ? `u/${prospect.authorHandle} · ` : ""}
            {prospect.matchedKeywords.join(", ")} · {relative(prospect.createdAt)}
          </span>
          <p
            style={{
              fontSize: "var(--size-body-sm)",
              color: "var(--text-body)",
              lineHeight: 1.5,
              maxWidth: "70ch",
            }}
          >
            {prospect.excerpt}
          </p>
          {prospect.relevanceRationale && (
            <span
              style={{
                fontSize: "var(--size-micro)",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              {prospect.relevanceRationale}
            </span>
          )}
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            {[prospect.contactName, prospect.contactTitle, prospect.contactEmail]
              .filter(Boolean)
              .join(" · ") || "No contact info yet"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          <Button
            size="sm"
            variant={contacted ? "secondary" : "primary"}
            iconLeft={<Icon name={contacted ? "check" : "user-check"} size={13} />}
            disabled={pending || dismissed}
            onClick={toggleContacted}
          >
            {contacted ? "Contacted" : "Mark contacted"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="mail-plus" size={13} />}
            disabled={drafting || dismissed}
            onClick={draftMessage}
          >
            {drafting ? "Drafting…" : "Draft outreach message"}
          </Button>
          {!dismissed && (
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name="x" size={13} />}
              disabled={pending}
              onClick={dismiss}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {contacted && prospect.contactedAt && (
        <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
          Contacted {shortDate(prospect.contactedAt)}
        </span>
      )}

      {draft && <CopyField label="Draft outreach message" value={draft} />}
    </div>
  );
}
