import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@falorb/db";
import { benchmarkReport } from "@falorb/queries";
import { Card } from "@falorb/ui";
import { resolveBenchmarkShare } from "@/server/sharing";
import { ch } from "@/server/clickhouse";
import { StatStrip } from "@/components/StatStrip";
import { BreakdownCard } from "@/components/BreakdownCard";
import { Empty } from "@/components/Empty";
import { duration, num, pct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/**
 * The organization-wide "state of X" benchmark report — rollup figures across
 * every property in an organization's portfolio, readable without an account.
 *
 * Unlike `/share/[token]`, this page is meant to be found. It exists as an
 * inbound-content play: real numbers worth linking to, published at a stable
 * URL. The privacy boundary is the query itself — see the doc comment on
 * `benchmarkReport` in packages/queries/src/benchmark.ts — rather than
 * anything enforced by this page: there is no per-project or per-person data
 * in the result set to begin with, so there is nothing here to leak beyond
 * what the org owner already chose to make public by creating the link.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const share = await resolveBenchmarkShare((await params).token);
  if (!share) return { title: "Not found" };

  return {
    // The root layout's title template already appends "· Falorb" — a
    // second "— Falorb" here would double up.
    title: `State of ${share.organizationName}'s properties`,
    description: `Aggregate visitor, session and channel benchmarks across ${share.organizationName}'s portfolio, published with Falorb.`,
    // The root layout sets `robots: {index:false}` for the whole app, since
    // the dashboard is private by default — this is the one page meant to
    // be found, so it has to override that explicitly rather than just
    // omitting `robots`, which would inherit the parent's noindex.
    robots: { index: true, follow: true },
  };
}

export default async function BenchmarkReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const share = await resolveBenchmarkShare((await params).token);
  // Unknown and revoked both land here, so probing cannot tell them apart.
  if (!share) notFound();

  const search = await searchParams;
  const resolved = resolveRange({
    range: one(search, "range"),
    from: one(search, "from"),
    to: one(search, "to"),
  });

  // The token only carries an organization id — the project ids behind it are
  // resolved here rather than by `resolveBenchmarkShare`, so that function's
  // return shape stays "just enough to query with" and never grows a project
  // list a public caller has no business seeing itemized.
  const projectRows = await db()
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.organizationId, share.organizationId), isNull(schema.projects.archivedAt)),
    );
  const projectIds = projectRows.map((row) => row.id);

  const report = await benchmarkReport(ch(), { projectIds, range: resolved.range });

  return (
    <main
      style={{
        height: "100%",
        overflowY: "auto",
        background: "var(--bg-app)",
        padding: "var(--space-10) var(--space-8)",
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          display: "grid",
          gap: "var(--space-8)",
        }}
      >
        <header style={{ display: "grid", gap: "var(--space-2)" }}>
          <h1 style={{ fontSize: "var(--size-title)" }}>State of {share.organizationName}</h1>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
            Last {resolved.label.toLowerCase()} · aggregate across every property · shared
            read-only
          </span>
        </header>

        {report.sessions === 0 ? (
          <Card>
            <Empty
              icon="radio"
              title="No traffic in this period"
              body={`Nothing was recorded across this portfolio in the last ${resolved.label.toLowerCase()}.`}
            />
          </Card>
        ) : (
          <>
            <StatStrip
              stats={[
                { label: "Unique visitors", value: num(report.visitors) },
                { label: "Sessions", value: num(report.sessions) },
                { label: "Pageviews", value: num(report.pageviews) },
                { label: "Avg. session", value: duration(report.avg_session_sec) },
                { label: "Median session", value: duration(report.median_session_sec) },
                { label: "Bounce rate", value: pct(report.bounce_rate), invertDelta: true },
              ]}
            />

            <BreakdownCard
              title="Top channels"
              subtitle="share of sessions, portfolio-wide"
              emptyBody="No referrer information was captured in this period."
              items={report.top_channels.map((row) => ({
                label: row.channel || "Direct",
                value: pct(row.share),
                count: row.share,
              }))}
            />
          </>
        )}

        <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", maxWidth: "66ch" }}>
          Rollup figures only — no individual property is identified, and nothing here can be
          traced back to a page, a session or a person.
        </p>
      </div>
    </main>
  );
}
