"use client";

import { useState } from "react";
import { Badge, Button, Card, Icon, SegmentedControl } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { CopyField } from "@/components/CopyField";
import { useToast } from "@/components/Toast";
import { regenerateSalesSignal } from "@/server/actions/signals";
import { markLeadContacted, draftOutreachMessage } from "@/server/actions/leads";
import { useAction } from "@/lib/use-action";
import { money, num, personLabel, relative, shortDate } from "@/lib/format";
import type { HotLead } from "@/server/sales";
import type { DateRange } from "@falorb/queries";

export interface SalesSignalView {
  body: string;
  generatedAt: string;
}

const SCOPE_LABELS = { project: "This property", portfolio: "Across your portfolio" } as const;
type Scope = keyof typeof SCOPE_LABELS;

/**
 * Who to personally reach out to, in two independently-cached scopes.
 *
 * "Across your portfolio" isn't about the one property this page happens to
 * be on — it's the same result wherever you open it from, since the whole
 * point is people active on more than one of your properties. The toggle
 * just switches which of the two already-fetched signals is shown; nothing
 * refetches on click.
 *
 * The prose above is a recommendation of *who and why*; the list below turns
 * each name in it into something to act on — mark contacted, or draft a
 * message — without leaving the panel.
 */
export function SalesSignalPanel({
  slug,
  range,
  signals,
  leads,
}: {
  slug: string;
  range: DateRange;
  signals: Record<Scope, SalesSignalView | null>;
  leads: Record<Scope, HotLead[]>;
}) {
  const [scope, setScope] = useState<Scope>("project");
  const { run, pending } = useAction();

  const signal = signals[scope];
  const scopedLeads = leads[scope];

  async function regenerate() {
    await run(() => regenerateSalesSignal(slug, range, scope), { success: "Recommendation updated" });
  }

  return (
    <Card
      title="Who to contact"
      subtitle="Generated from lead score, activity and company data — not a new data source"
      action={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SegmentedControl
            size="sm"
            options={Object.values(SCOPE_LABELS)}
            value={SCOPE_LABELS[scope]}
            onChange={(label: string) =>
              setScope((Object.keys(SCOPE_LABELS) as Scope[]).find((k) => SCOPE_LABELS[k] === label) ?? "project")
            }
          />
          <Button size="sm" variant="secondary" onClick={regenerate} disabled={pending}>
            {pending ? "Generating…" : signal ? "Regenerate" : "Generate"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {signal ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <p
              style={{
                fontSize: "var(--size-body)",
                lineHeight: 1.6,
                color: "var(--text-body)",
                whiteSpace: "pre-wrap",
              }}
            >
              {signal.body}
            </p>
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              Generated {relative(signal.generatedAt)}
            </span>
          </div>
        ) : (
          <Empty
            dense
            icon="sparkles"
            title="No recommendation yet"
            body={
              scope === "project"
                ? "Generate one from this property's highest lead-score visitors."
                : "Generate one from people active across more than one of your properties."
            }
          />
        )}

        {scopedLeads.length > 0 && (
          <div style={{ display: "grid", gap: "var(--space-2)", borderTop: "1px solid var(--border-subtle)", paddingTop: "var(--space-4)" }}>
            {scopedLeads.map((lead) => (
              <LeadRow key={lead.personId} slug={slug} scope={scope} lead={lead} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function LeadRow({ slug, scope, lead }: { slug: string; scope: Scope; lead: HotLead }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const label = lead.name ?? lead.email ?? lead.identifiedId ?? personLabel(lead.personId);
  const contacted = lead.contactedAt != null;

  async function toggleContacted() {
    await run(() => markLeadContacted(slug, lead.personId, !contacted), {
      success: contacted ? "Marked as not contacted" : "Marked as contacted",
    });
  }

  async function draftMessage() {
    setDrafting(true);
    try {
      const result = await draftOutreachMessage(slug, lead.personId, scope);
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
        padding: "var(--space-3) 0",
        borderBottom: "1px solid var(--grid-line)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: "var(--size-body-sm)", fontWeight: "var(--wt-medium)", color: "var(--text-primary)" }}>
              {label}
            </span>
            <Badge tone="accent" mono>
              {num(lead.leadScore)}
            </Badge>
          </div>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            {[lead.email, lead.companyName ?? lead.companyDomain].filter(Boolean).join(" · ") || "No contact details on file"}
          </span>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
            {num(lead.totalSessions)} sessions · {num(lead.totalPageviews)} pageviews
            {Number(lead.totalRevenue) > 0 ? ` · ${money(Number(lead.totalRevenue))}` : ""} · last seen{" "}
            {relative(lead.lastSeenAt)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "0 0 auto" }}>
          <Button
            size="sm"
            variant={contacted ? "secondary" : "primary"}
            iconLeft={<Icon name={contacted ? "check" : "user-check"} size={13} />}
            disabled={pending}
            onClick={toggleContacted}
          >
            {contacted ? "Contacted" : "Mark contacted"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="mail-plus" size={13} />}
            disabled={drafting}
            onClick={draftMessage}
          >
            {drafting ? "Drafting…" : "Draft outreach message"}
          </Button>
        </div>
      </div>

      {contacted && lead.contactedAt && (
        <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
          Contacted {shortDate(lead.contactedAt)}
        </span>
      )}

      {draft && <CopyField label="Draft outreach message" value={draft} />}
    </div>
  );
}
