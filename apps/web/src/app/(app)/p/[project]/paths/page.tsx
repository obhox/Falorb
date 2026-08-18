import { Card, ChartFrame } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { entryPages, exitPages, frustration, pathTransitions } from "@/server/analytics";
import { PageBody } from "@/components/shell/PageHeader";
import { PathSankey } from "@/components/PathSankey";
import { Empty } from "@/components/Empty";
import { Table } from "@/components/Table";
import { duration, num, pct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/**
 * Where people go, and where they stop.
 *
 * Three views of the same journey: the transition graph, the pages people
 * leave from, and the pages that frustrate them. Exit *rate* rather than exit
 * count — a page with ten exits from twelve views is a problem, one with a
 * thousand exits from a hundred thousand views is the homepage.
 */
export default async function PathsPage({
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

  const startPath = one(search, "path");
  const scope = { projectIds: [project.id], range: resolved.range };

  const [transitions, exits, entries, frustrations] = await Promise.all([
    pathTransitions({ ...scope, limit: 40, ...(startPath ? { startPath } : {}) }),
    exitPages({ ...scope, limit: 12 }),
    entryPages({ ...scope, limit: 12 }),
    frustration({ ...scope, limit: 12 }),
  ]);

  return (
    <PageBody>
      <ChartFrame
        title="Journeys"
        subtitle={
          startPath
            ? `Transitions from ${startPath} · ${resolved.label.toLowerCase()}`
            : `Most travelled page-to-page transitions · ${resolved.label.toLowerCase()}`
        }
        height={340}
      >
        {transitions.length === 0 ? (
          <Empty
            icon="git-fork"
            title="No page-to-page movement recorded"
            body="Transitions are rebuilt by a worker every 15 minutes, and need at least two pageviews in one session. A very new property will have none yet."
          />
        ) : (
          <PathSankey
            transitions={transitions.map((row) => ({
              from: row.from_path,
              to: row.to_path,
              value: row.transitions,
            }))}
          />
        )}
      </ChartFrame>

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
              head={["Page", "Exit rate", "Exits", "Avg. time"]}
              rows={exits.map((row) => [
                row.path || "/",
                pct(row.exit_rate),
                num(row.exits),
                duration(row.avg_time_sec),
              ])}
            />
          )}
        </Card>
      </div>

      <Card
        title="Frustration"
        subtitle="Rage clicks, dead clicks and errors, by page"
      >
        {frustrations.length === 0 ? (
          <Empty
            dense
            icon="smile"
            title="No frustration signals"
            body="No rage clicks or JavaScript errors were recorded. Dead-click detection is not implemented yet, so that column is always zero."
          />
        ) : (
          <Table
            head={["Page", "Rage clicks", "Errors", "Affected"]}
            rows={frustrations.map((row) => [
              row.path || "/",
              num(row.rage_clicks),
              num(row.errors),
              num(row.affected_visitors),
            ])}
          />
        )}
      </Card>
    </PageBody>
  );
}
