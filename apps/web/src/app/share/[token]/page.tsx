import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@falorb/ui";
import { resolveShare } from "@/server/sharing";
import { breakdown, totals, trend } from "@/server/analytics";
import { StatStrip } from "@/components/StatStrip";
import { TrendPanel } from "@/components/TrendPanel";
import { BreakdownCard } from "@/components/BreakdownCard";
import { Empty } from "@/components/Empty";
import { bucketGrid, seriesFromTrend } from "@/lib/series";
import { countryLabel, delta, duration, num, pct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/**
 * A property's summary, readable without an account.
 *
 * What this page may show is the whole design of the feature. It renders
 * aggregates for exactly one property and nothing else — no people, no
 * sessions, no event stream, no sibling properties, no settings, no workspace
 * name. Everything here is a count over a population; nothing identifies
 * anyone. A share link that leaked a person list would be a privacy incident
 * in a product whose entire pitch is first-party analytics.
 *
 * It also sits outside the `(app)` route group, so it never touches the
 * authenticated shell and cannot inherit a session by accident.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const share = await resolveShare((await params).token);

  return {
    title: share ? `${share.projectName} — analytics` : "Not found",
    // A shared link is unlisted, not public. Indexing one would put figures the
    // owner shared with three people into a search result.
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function SharedSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const share = await resolveShare((await params).token);
  // Unknown, revoked and archived all land here, so probing cannot tell them
  // apart.
  if (!share) notFound();

  const search = await searchParams;
  const resolved = resolveRange({
    range: one(search, "range"),
    from: one(search, "from"),
    to: one(search, "to"),
  });

  const scope = { projectIds: [share.projectId], range: resolved.range };

  const [current, previous, visitorTrend, pages, channels, countries] = await Promise.all([
    totals(scope),
    totals({ projectIds: [share.projectId], range: resolved.previous }),
    trend({ ...scope, metric: "visitors", interval: resolved.interval }),
    breakdown({ ...scope, field: "path", limit: 8 }),
    breakdown({ ...scope, field: "channel", limit: 8 }),
    breakdown({ ...scope, field: "country", limit: 8 }),
  ]);

  const buckets = bucketGrid(resolved.range, resolved.interval);
  const visitors = seriesFromTrend(visitorTrend, buckets.keys, resolved.interval);

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
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: "var(--size-title)" }}>{share.projectName}</h1>
            {share.domain && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--size-label)",
                  color: "var(--text-muted)",
                }}
              >
                {share.domain}
              </span>
            )}
          </div>
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
            Last {resolved.label.toLowerCase()} · shared read-only
          </span>
        </header>

        {current.events === 0 ? (
          <Card>
            <Empty
              icon="radio"
              title="No traffic in this period"
              body={`Nothing was recorded in the last ${resolved.label.toLowerCase()}.`}
            />
          </Card>
        ) : (
          <>
            <StatStrip
              stats={[
                {
                  label: "Unique visitors",
                  value: num(current.visitors),
                  delta: delta(current.visitors, previous.visitors),
                },
                {
                  label: "Sessions",
                  value: num(current.sessions),
                  delta: delta(current.sessions, previous.sessions),
                },
                {
                  label: "Pageviews",
                  value: num(current.pageviews),
                  delta: delta(current.pageviews, previous.pageviews),
                },
                {
                  label: "Avg. session",
                  value: duration(current.avg_session_sec),
                  delta: delta(current.avg_session_sec, previous.avg_session_sec),
                },
                {
                  label: "Bounce rate",
                  value: pct(current.bounce_rate),
                  delta: delta(current.bounce_rate, previous.bounce_rate),
                  invertDelta: true,
                },
              ]}
            />

            <TrendPanel
              title="Visitors"
              subtitle={`${resolved.label} · by ${resolved.interval}`}
              labels={buckets.labels}
              series={[{ name: "Visitors", data: visitors }]}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                gap: "var(--space-6)",
              }}
            >
              <BreakdownCard
                title="Top pages"
                subtitle="by unique visitors"
                emptyBody="No pageviews were recorded in this period."
                items={pages.map((row) => ({
                  label: row.value || "/",
                  value: num(row.visitors),
                  count: row.visitors,
                }))}
              />
              <BreakdownCard
                title="Channels"
                subtitle="how people arrived"
                emptyBody="No referrer information was captured in this period."
                items={channels.map((row) => ({
                  label: row.value || "Direct",
                  value: num(row.visitors),
                  count: row.visitors,
                }))}
              />
              <BreakdownCard
                title="Countries"
                subtitle="from a hashed IP, never a raw address"
                emptyBody="No location could be resolved for these visits."
                items={countries.map((row) => ({
                  label: countryLabel(row.value),
                  value: num(row.visitors),
                  count: row.visitors,
                }))}
              />
            </div>
          </>
        )}

        <footer
          style={{
            paddingTop: "var(--space-6)",
            borderTop: "1px solid var(--border-subtle)",
            fontSize: "var(--size-micro)",
            color: "var(--text-muted)",
          }}
        >
          Measured with Falorb — self-hosted, first-party analytics. No cookies are set by this
          page, and it identifies nobody.
        </footer>
      </div>
    </main>
  );
}
