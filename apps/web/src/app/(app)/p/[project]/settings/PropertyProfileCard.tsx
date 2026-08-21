"use client";

import { Badge, Button, Card, Icon } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { recrawlProperty } from "@/server/actions/property-profile";
import { shortDate } from "@/lib/format";

export interface PropertyProfileView {
  summary: string | null;
  icp: string | null;
  keyFeatures: string[];
  suggestedKeywords: string[];
  crawledAt: string | null;
  hasDomain: boolean;
}

/**
 * What Falorb has learned this property actually is, from crawling its own
 * homepage — feeds the relevance scoring on `reddit-listener.ts`/
 * `hackernews-listener.ts`/`job-listener.ts` and grounds outreach drafts,
 * instead of those only having a bare project name to reason with. Same
 * on-demand "crawl/refresh" shape as `CompanyResearchCard`, just for the
 * property itself rather than a lead's employer, and also populated
 * automatically by the `property-profiler` worker job after onboarding or
 * once stale (see that job's docblock).
 */
export function PropertyProfileCard({
  slug,
  profile,
  canEdit,
}: {
  slug: string;
  profile: PropertyProfileView;
  canEdit: boolean;
}) {
  const { run, pending } = useAction();

  const hasProfile = Boolean(
    profile.summary || profile.icp || profile.keyFeatures.length || profile.suggestedKeywords.length,
  );

  return (
    <Card
      title="Property profile"
      subtitle="What this property does, crawled from its own site — sharpens prospecting relevance and outreach drafts"
    >
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        {!profile.hasDomain ? (
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)", margin: 0 }}>
            Add a domain below first — there's nothing to crawl without one.
          </p>
        ) : !hasProfile ? (
          <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-muted)", margin: 0 }}>
            Not crawled yet. This happens automatically not long after a property is added, or
            trigger it now.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {profile.summary && (
              <Field label="What it does" value={profile.summary} />
            )}
            {profile.icp && <Field label="Ideal customer" value={profile.icp} />}
            {profile.keyFeatures.length > 0 && (
              <TagField label="Key features" values={profile.keyFeatures} />
            )}
            {profile.suggestedKeywords.length > 0 && (
              <TagField
                label="Suggested prospecting keywords"
                values={profile.suggestedKeywords}
                tone="accent"
              />
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {canEdit && profile.hasDomain && (
            <Button
              size="sm"
              iconLeft={<Icon name="search" size={12} />}
              disabled={pending}
              onClick={() =>
                void run(() => recrawlProperty(slug), {
                  success: "Property profile updated from web research.",
                })
              }
            >
              {pending ? "Crawling…" : hasProfile ? "Re-crawl" : "Crawl this property"}
            </Button>
          )}
          {profile.crawledAt && (
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              Last crawled {shortDate(profile.crawledAt)}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <span
        style={{
          fontSize: "var(--size-micro)",
          textTransform: "uppercase",
          letterSpacing: "var(--ls-label)",
          color: "var(--text-muted)",
          fontWeight: "var(--wt-medium)",
        }}
      >
        {label}
      </span>
      <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-body)", lineHeight: 1.5, margin: 0 }}>
        {value}
      </p>
    </div>
  );
}

function TagField({
  label,
  values,
  tone = "neutral",
}: {
  label: string;
  values: string[];
  tone?: "neutral" | "accent";
}) {
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <span
        style={{
          fontSize: "var(--size-micro)",
          textTransform: "uppercase",
          letterSpacing: "var(--ls-label)",
          color: "var(--text-muted)",
          fontWeight: "var(--wt-medium)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {values.map((value) => (
          <Badge key={value} tone={tone}>
            {value}
          </Badge>
        ))}
      </div>
    </div>
  );
}
