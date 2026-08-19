import { Card } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { breakdown, contentInterests, entryPages, exitPages } from "@/server/analytics";
import { listContentDrafts } from "@/server/actions/content-draft";
import { PageBody } from "@/components/shell/PageHeader";
import { BreakdownCard } from "@/components/BreakdownCard";
import { Empty } from "@/components/Empty";
import { Table } from "@/components/Table";
import { RisingThinPanel } from "./RisingThinPanel";
import { DraftsCard } from "./DraftsCard";
import { delta, num, pct, signedPct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/** A page with real traffic and an exit rate high enough to be worth fixing. */
const ATTENTION_EXIT_RATE = 60;
/** A rising topic backed by this few pages is a coverage gap, not noise. */
const THIN_COVERAGE_PATHS = 2;

/**
 * What's working, what's not, and what to focus on next.
 *
 * Page performance ("what's working") composes queries the platform already
 * had. The interest graph ("what people care about") is the same topic signal
 * that already powers per-person interest scoring, rolled up to the project —
 * derived from `content_tag` where a site sends it, otherwise a URL-path
 * proxy, which is why that provenance is stated on the panel rather than left
 * implicit.
 */
export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { project } = await requireProject((await params).project);
  const search = await searchParams;
  const resolved = resolveRange({
    range: one(search, "range"),
    from: one(search, "from"),
    to: one(search, "to"),
  });

  const scope = { projectIds: [project.id], range: resolved.range };

  const [pages, entries, exits, interests, interestsPrevious, drafts] = await Promise.all([
    breakdown({ ...scope, field: "path", limit: 15 }),
    entryPages({ ...scope, limit: 10 }),
    exitPages({ ...scope, limit: 10, minPageviews: 10 }),
    contentInterests({ ...scope, limit: 15 }),
    contentInterests({ projectIds: [project.id], range: resolved.previous, limit: 15 }),
    listContentDrafts(project.slug),
  ]);

  // High-traffic pages that are also losing people — the concrete "what's not
  // working", found by joining two panels the reader would otherwise have to
  // cross-reference by eye.
  const exitByPath = new Map(exits.map((row) => [row.path, row]));
  const needsAttention = pages
    .map((page) => ({ page, exit: exitByPath.get(page.value) }))
    .filter(
      (row): row is { page: (typeof pages)[number]; exit: (typeof exits)[number] } =>
        row.exit != null && row.exit.exit_rate > ATTENTION_EXIT_RATE,
    );

  // Topics gaining visitors but backed by only a page or two — audience wants
  // more of this, and there is barely anything to show them yet.
  const previousByTopic = new Map(interestsPrevious.map((row) => [row.topic, row.visitors]));
  const interestRows = interests.map((row) => {
    const previousVisitors = previousByTopic.get(row.topic);
    const isNew = previousVisitors == null;
    return { ...row, isNew, changePct: isNew ? null : delta(row.visitors, previousVisitors) };
  });
  const risingThin = interestRows.filter(
    (row) => (row.isNew || (row.changePct != null && row.changePct > 0)) &&
      row.distinct_paths <= THIN_COVERAGE_PATHS,
  );

  return (
    <PageBody>
      {needsAttention.length > 0 && (
        <Card
          title="Needs attention"
          subtitle="High-traffic pages losing a majority of visitors on exit"
        >
          <Table
            head={["Page", "Visitors", "Exit rate"]}
            rows={needsAttention.map(({ page, exit }) => [
              page.value || "/",
              num(page.visitors),
              pct(exit.exit_rate),
            ])}
          />
        </Card>
      )}

      <BreakdownCard
        title="Top pages"
        subtitle={`by unique visitors · ${resolved.label.toLowerCase()}`}
        emptyBody="No pageviews were recorded in this range."
        items={pages.map((row) => ({
          label: row.value || "/",
          value: num(row.visitors),
          count: row.visitors,
          meta: `${num(row.pageviews)} views`,
          href: `/p/${project.slug}/paths?path=${encodeURIComponent(row.value)}`,
        }))}
      />

      <div
        className="falorb-grid-2pane"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "var(--space-6)",
        }}
      >
        <Card title="Entry pages" subtitle="Where sessions begin">
          {entries.length === 0 ? (
            <Empty dense icon="log-in" title="No entries recorded" body="No sessions started in this range." />
          ) : (
            <Table
              head={["Page", "Entries", "Visitors", "Bounce"]}
              rows={entries.map((row) => [
                row.path || "/",
                num(row.entries),
                num(row.visitors),
                pct(row.bounce_rate),
              ])}
            />
          )}
        </Card>

        <Card title="Exit pages" subtitle="Ranked by exit rate, not exit count">
          {exits.length === 0 ? (
            <Empty dense icon="log-out" title="No exits recorded" body="No sessions ended in this range." />
          ) : (
            <Table
              head={["Page", "Exit rate", "Exits"]}
              rows={exits.map((row) => [row.path || "/", pct(row.exit_rate), num(row.exits)])}
            />
          )}
        </Card>
      </div>

      <Card
        title="Interest graph"
        subtitle="Derived from content_tag where sites send it, otherwise the URL path — a behavioural proxy, not curated categorization"
      >
        {interestRows.length === 0 ? (
          <Empty
            dense
            icon="sparkles"
            title="No topics detected"
            body="No pageviews carried a content_tag or a recognizable path segment in this range."
          />
        ) : (
          <Table
            head={["Topic", "Visitors", "Change", "Pages"]}
            rows={interestRows.map((row) => [
              row.topic,
              num(row.visitors),
              row.isNew ? "New" : signedPct(row.changePct),
              num(row.distinct_paths),
            ])}
          />
        )}
      </Card>

      {risingThin.length > 0 && (
        <RisingThinPanel
          slug={project.slug}
          rows={risingThin.map((row) => ({
            topic: row.topic,
            visitors: row.visitors,
            isNew: row.isNew,
            changePct: row.changePct,
            distinctPaths: row.distinct_paths,
          }))}
        />
      )}

      {drafts.length > 0 && <DraftsCard slug={project.slug} drafts={drafts} />}
    </PageBody>
  );
}
