import Link from "next/link";
import { Card } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { getSeoSnapshot } from "@/server/seo";
import { PageBody } from "@/components/shell/PageHeader";
import { Empty } from "@/components/Empty";
import { StatStrip } from "@/components/StatStrip";
import { Table } from "@/components/Table";
import { num, pct } from "@/lib/format";

export const metadata = { title: "SEO" };
export const dynamic = "force-dynamic";

/**
 * A property's live SEO standing from OpenSEO — domain overview, top
 * ranking keywords, backlinks, rank tracker movement, and Search Console
 * performance. Called fresh on every load rather than mirrored (see
 * `@/server/seo`'s doc comment): this is a snapshot of the current state of
 * one domain, not a list of rows Falorb keeps its own copy of.
 */
export default async function SeoPage({ params }: { params: Promise<{ project: string }> }) {
  const { session, project } = await requireProject((await params).project);
  const domain = project.domains[0] ?? null;

  if (!domain) {
    return (
      <PageBody>
        <Empty
          icon="globe"
          title="No domain set for this property"
          body="OpenSEO looks up keyword, ranking, and backlink data by domain — add one in Settings before connecting OpenSEO."
          action={
            <Link href={`/p/${project.slug}/settings`} style={{ textDecoration: "none" }}>
              Go to Settings
            </Link>
          }
        />
      </PageBody>
    );
  }

  const snapshot = await getSeoSnapshot(session.workspace.organizationId, project.id, domain);

  if (!snapshot) {
    return (
      <PageBody>
        <Empty
          icon="search"
          title="OpenSEO isn't connected"
          body={`Connect it to see ${domain}'s domain overview, ranking keywords, backlinks, rank tracking, and Search Console performance here.`}
          action={
            <Link href={`/p/${project.slug}/settings`} style={{ textDecoration: "none" }}>
              Connect in Settings → Integrations
            </Link>
          }
        />
      </PageBody>
    );
  }

  const { overview, keywords, backlinks, rankTracker, gscPerformance, errors } = snapshot;

  return (
    <PageBody>
      {errors.length > 0 && (
        <Card title="Some panels didn't load" subtitle="The rest of this page is still accurate.">
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            {errors.map((e) => (
              <li key={e} style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)" }}>
                {e}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <StatStrip
        stats={[
          { label: "Organic traffic", value: num(overview?.organicTraffic ?? null) },
          { label: "Organic keywords", value: num(overview?.organicKeywords ?? null) },
          { label: "Referring domains", value: num(backlinks?.referringDomains ?? null) },
          { label: "Total backlinks", value: num(backlinks?.totalBacklinks ?? null) },
        ]}
      />

      <Card title="Ranking keywords" subtitle={`Keywords ${domain} currently ranks for`}>
        {keywords.length === 0 ? (
          <Empty dense icon="search" title="No ranking keywords found" body="OpenSEO has no keyword data for this domain yet." />
        ) : (
          <Table
            head={["Keyword", "Position", "Volume", "URL"]}
            rows={keywords.map((k) => [k.keyword, num(k.position ?? null), num(k.volume ?? null), k.url ?? "—"])}
          />
        )}
      </Card>

      <Card title="Rank tracker" subtitle="Tracked keyword positions from OpenSEO's rank tracker">
        {rankTracker.length === 0 ? (
          <Empty
            dense
            icon="line-chart"
            title="No tracked keywords"
            body="Add keywords to the rank tracker in OpenSEO to see movement here."
          />
        ) : (
          <Table
            head={["Keyword", "Position", "Previous", "URL"]}
            rows={rankTracker.map((r) => [
              r.keyword,
              num(r.position ?? null),
              num(r.previousPosition ?? null),
              r.url ?? "—",
            ])}
          />
        )}
      </Card>

      <Card title="Search Console performance" subtitle="Clicks, impressions, CTR, and average position">
        {gscPerformance.length === 0 ? (
          <Empty
            dense
            icon="bar-chart-2"
            title="No Search Console data"
            body="Connect a Search Console property to OpenSEO to see query performance here."
          />
        ) : (
          <Table
            head={["Query", "Page", "Clicks", "Impressions", "CTR", "Position"]}
            rows={gscPerformance.map((r) => [
              r.query ?? "—",
              r.page ?? "—",
              num(r.clicks ?? null),
              num(r.impressions ?? null),
              pct(r.ctr != null ? r.ctr * 100 : null),
              r.position != null ? r.position.toFixed(1) : "—",
            ])}
          />
        )}
      </Card>
    </PageBody>
  );
}
