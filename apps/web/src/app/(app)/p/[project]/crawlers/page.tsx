import { Badge, Card } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { breakdown, totals, trend } from "@/server/analytics";
import { PageBody } from "@/components/shell/PageHeader";
import { StatStrip } from "@/components/StatStrip";
import { TrendPanel } from "@/components/TrendPanel";
import { BreakdownCard } from "@/components/BreakdownCard";
import { Empty } from "@/components/Empty";
import { bucketGrid, seriesByName, seriesFromTrend } from "@/lib/series";
import {
  AGENT_VENDOR,
  AI_REFERRER_SOURCES,
  ROBOTS_TOKEN,
  classify,
  isAi,
  KIND_LABELS,
  KIND_NOTES,
  type AgentKind,
} from "@/lib/crawlers";
import { delta, num, pct } from "@/lib/format";
import { one, resolveRange, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

/**
 * How AI uses this property.
 *
 * Two halves, and they are the whole point of the screen:
 *
 *   What the assistants *take* — every fetch by ChatGPT, Claude, Perplexity and
 *   the rest, split by whether a person was waiting on the other end or it was
 *   bulk ingestion.
 *
 *   What they *send back* — people arriving here from an assistant. This is the
 *   only number that says the reading turned into a reader.
 *
 * Bot traffic is excluded from every other screen, correctly: a crawler is not
 * a visitor. Here it is the subject, so every query sets `includeBots: true`.
 */
export default async function CrawlersPage({
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

  const agentScope = {
    projectIds: [project.id],
    range: resolved.range,
    includeBots: true,
    // Anything with a name is an agent; humans carry an empty bot_name.
    filters: [{ field: "bot_name", op: "is_set" as const }],
  };

  const [agents, previousAgents, agentTrend, pages, referrerSources, humans] = await Promise.all([
    breakdown({ ...agentScope, field: "bot_name", limit: 50 }),
    breakdown({ ...agentScope, range: resolved.previous, field: "bot_name", limit: 50 }),
    trend({
      ...agentScope,
      metric: "events",
      interval: resolved.interval,
      breakdown: "bot_name",
      limit: 3,
    }),
    breakdown({ ...agentScope, field: "path", limit: 12 }),
    // Referrals are human traffic, so this one deliberately excludes bots.
    breakdown({ projectIds: [project.id], range: resolved.range, field: "source", limit: 60 }),
    totals({ projectIds: [project.id], range: resolved.range }),
  ]);

  const named = agents.filter((row) => row.value);
  const aiAgents = named.filter((row) => isAi(row.value));

  const answering = aiAgents.filter((row) => classify(row.value) === "ai-answering");
  const ingesting = aiAgents.filter((row) => classify(row.value) === "ai-ingesting");

  const answeringEvents = sum(answering);
  const ingestingEvents = sum(ingesting);
  const aiEvents = answeringEvents + ingestingEvents;

  const previousAi = previousAgents.filter((row) => isAi(row.value)).reduce((t, r) => t + r.events, 0);

  const aiReferrals = referrerSources.filter((row) => AI_REFERRER_SOURCES.has(row.value));
  const aiReferralVisitors = aiReferrals.reduce((total, row) => total + row.visitors, 0);

  const byKind = new Map<AgentKind, number>();
  for (const row of named) {
    const kind = classify(row.value);
    byKind.set(kind, (byKind.get(kind) ?? 0) + row.events);
  }

  const buckets = bucketGrid(resolved.range, resolved.interval);
  const topAgentSeries = seriesByName(agentTrend, buckets.keys, resolved.interval).slice(0, 3);

  if (named.length === 0 && aiReferrals.length === 0) {
    return (
      <PageBody>
        <Card>
          <Empty
            icon="bot"
            title="No AI or crawler activity in this range"
            body={`Nothing matching a known agent signature reached this property in the last ${resolved.label.toLowerCase()}, and nobody arrived from an assistant. Agents are identified from the user-agent at ingest and stored — they are just excluded from visitor metrics.`}
          />
        </Card>
      </PageBody>
    );
  }

  return (
    <PageBody>
      <StatStrip
        stats={[
          {
            label: "Answering someone",
            value: num(answeringEvents),
            footnote: "a person was waiting",
          },
          {
            label: "Ingesting content",
            value: num(ingestingEvents),
            footnote: "training and index crawls",
          },
          {
            label: "All AI requests",
            value: num(aiEvents),
            delta: delta(aiEvents, previousAi),
          },
          {
            label: "Arrived from an assistant",
            value: num(aiReferralVisitors),
            footnote:
              humans.visitors > 0
                ? `${pct((aiReferralVisitors / humans.visitors) * 100)} of visitors`
                : undefined,
          },
        ]}
      />

      <Card
        title="AI assistants"
        subtitle="Every agent that fetched this property, and why"
      >
        {aiAgents.length === 0 ? (
          <Empty
            dense
            icon="bot"
            title="No AI agents seen"
            body="No requests from ChatGPT, Claude, Perplexity or the other named assistants in this range."
          />
        ) : (
          <div style={{ display: "grid", gap: 1 }}>
            <div style={head}>
              <span>Agent</span>
              <span>Why</span>
              <span style={{ textAlign: "right" }}>Requests</span>
              <span style={{ textAlign: "right" }}>Share</span>
              <span>robots.txt</span>
            </div>

            {[...answering, ...ingesting].map((row) => {
              const kind = classify(row.value);
              const isAnswering = kind === "ai-answering";
              return (
                <div key={row.value} style={body}>
                  <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: "var(--size-body-sm)",
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.value}
                    </span>
                    <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
                      {AGENT_VENDOR[row.value] ?? "—"}
                    </span>
                  </span>

                  <Badge tone={isAnswering ? "accent" : "neutral"}>
                    {isAnswering ? "answering" : "ingesting"}
                  </Badge>

                  <span style={figure}>{num(row.events)}</span>
                  <span style={{ ...figure, color: "var(--text-muted)" }}>
                    {aiEvents > 0 ? pct((row.events / aiEvents) * 100) : "—"}
                  </span>

                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--size-micro)",
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {ROBOTS_TOKEN[row.value] ?? "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            marginTop: "var(--space-7)",
            display: "grid",
            gap: 8,
            padding: "var(--space-5) var(--space-6)",
            borderRadius: "var(--radius-3)",
            background: "var(--surface-inset)",
            border: "1px solid var(--border-subtle)",
            maxWidth: "66ch",
          }}
        >
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-body)", lineHeight: "var(--lh-normal)" }}>
            <strong>Answering</strong> means somebody asked an assistant about this page and it
            fetched the page to reply. That is a reader you would otherwise never see —
            they never load the page themselves, so no other screen counts them.
          </span>
          <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", lineHeight: "var(--lh-normal)" }}>
            Every agent listed honours robots.txt under the token shown. Blocking one is a real
            trade: it stops the ingestion, and it also stops the assistant describing your page
            accurately to the next person who asks. Identification comes from the user-agent
            string, which any client can set — so this is a faithful record of agents that
            identify themselves, and says nothing about ones that do not.
          </span>
        </div>
      </Card>

      <Card
        title="Traffic back from assistants"
        subtitle="People who arrived here after an assistant answered them"
      >
        {aiReferrals.length === 0 ? (
          <Empty
            dense
            icon="corner-down-right"
            title="No referrals from assistants"
            body="Nobody arrived from ChatGPT, Claude, Perplexity or similar in this range. Assistants that answer inline without a citation link produce no referral, so reading without referral traffic is the normal case."
          />
        ) : (
          <div style={{ display: "grid", gap: 1 }}>
            <div style={{ ...head, gridTemplateColumns: referralColumns }}>
              <span>Assistant</span>
              <span style={{ textAlign: "right" }}>Visitors</span>
              <span style={{ textAlign: "right" }}>Sessions</span>
              <span style={{ textAlign: "right" }}>Pageviews</span>
            </div>
            {aiReferrals
              .sort((a, b) => b.visitors - a.visitors)
              .map((row) => (
                <div key={row.value} style={{ ...body, gridTemplateColumns: referralColumns }}>
                  <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>
                    {row.value}
                  </span>
                  <span style={figure}>{num(row.visitors)}</span>
                  <span style={figure}>{num(row.sessions)}</span>
                  <span style={figure}>{num(row.pageviews)}</span>
                </div>
              ))}
          </div>
        )}
      </Card>

      {topAgentSeries.length > 0 && (
        <TrendPanel
          title="Agent activity over time"
          subtitle={`Top ${topAgentSeries.length} agents · ${resolved.label} · by ${resolved.interval}`}
          labels={buckets.labels}
          series={topAgentSeries}
        />
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "var(--space-6)",
        }}
      >
        <BreakdownCard
          title="Every agent, by purpose"
          subtitle="AI, search, and everything else"
          emptyBody="No agents were identified in this range."
          items={[...byKind.entries()]
            .sort(([, a], [, b]) => b - a)
            .map(([kind, events]) => ({
              label: KIND_LABELS[kind],
              value: num(events),
              count: events,
              meta: KIND_NOTES[kind].split(".")[0],
            }))}
        />

        <BreakdownCard
          title="What AI is reading"
          subtitle="pages fetched by assistants"
          emptyBody="No page context was attached to these requests."
          items={pages.map((row) => ({
            label: row.value || "/",
            value: num(row.events),
            count: row.events,
          }))}
        />
      </div>
    </PageBody>
  );
}

function sum(rows: { events: number }[]): number {
  return rows.reduce((total, row) => total + row.events, 0);
}

const columns = "minmax(0,1.1fr) 110px 100px 80px minmax(0,0.9fr)";
const referralColumns = "minmax(0,1fr) 110px 110px 110px";

const head: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: columns,
  gap: 12,
  height: 30,
  alignItems: "center",
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "var(--size-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-label)",
  color: "var(--text-muted)",
  fontWeight: "var(--wt-medium)",
};

const body: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: columns,
  gap: 12,
  minHeight: "var(--row-height)",
  alignItems: "center",
  borderBottom: "1px solid var(--grid-line)",
};

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-body-sm)",
  color: "var(--text-primary)",
  textAlign: "right",
};
