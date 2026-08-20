import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon, Tag } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { getPerson } from "@/server/people";
import {
  acquisitionChain,
  personInterests,
  personProjects,
  personTimeline,
} from "@/server/analytics";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { StatStrip } from "@/components/StatStrip";
import { Empty } from "@/components/Empty";
import { PersonTimeline } from "@/components/PersonTimeline";
import { CompanyResearchCard } from "./CompanyResearchCard";
import {
  countryLabel,
  dateTime,
  money,
  num,
  personLabel,
  relative,
  shortDate,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personId: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  const detail = await getPerson(session.workspace.organizationId, (await params).personId);
  if (!detail) return { title: "Person" };
  return {
    title: detail.person.email ?? detail.person.name ?? personLabel(detail.person.id),
  };
}

/**
 * The person profile — one human, read across the whole portfolio.
 *
 * This is the screen the identity graph exists to produce: every property they
 * used, every campaign that ever sent them, what they read, and a single
 * timeline that crosses product boundaries.
 *
 * The timeline is scoped to the caller's projects rather than to the person's
 * own `projectIds`. Those two are usually the same set; where they differ, the
 * person has been seen on a project this organization no longer owns, and the
 * session's list is the one that carries the authorisation.
 */
export default async function PersonPage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const session = await requireSession();
  const { personId } = await params;

  const detail = await getPerson(session.workspace.organizationId, personId);
  if (!detail) notFound();

  const { person, company, aliases } = detail;
  const projectIds = session.projects.map((p) => p.id);
  const projectsById = new Map(session.projects.map((p) => [p.id, p]));

  const [usage, timeline, acquisition, interests] = await Promise.all([
    personProjects({ personId: person.id, projectIds }),
    personTimeline({ personId: person.id, projectIds, limit: 100 }),
    acquisitionChain({ personId: person.id, projectIds, limit: 25 }),
    personInterests({ personId: person.id, projectIds, limit: 12 }),
  ]);

  const now = Date.now();
  const display = person.email ?? person.name ?? person.identifiedId ?? personLabel(person.id);
  const revenue = Number(person.totalRevenue);

  return (
    <>
      <PageHeader
        title={display}
        meta={person.identifiedId ? undefined : "anonymous"}
        actions={
          <Link href="/" style={{ textDecoration: "none" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: "var(--size-label)",
                color: "var(--text-secondary)",
              }}
            >
              <Icon name="arrow-left" size={13} />
              All properties
            </span>
          </Link>
        }
      />

      <PageBody>
        <StatStrip
          stats={[
            { label: "Sessions", value: num(person.totalSessions) },
            { label: "Events", value: num(person.totalEvents) },
            {
              label: "Properties used",
              value: num(usage.length),
              footnote: usage.length > 1 ? "crosses products" : undefined,
            },
            { label: "Lead score", value: num(person.leadScore) },
            ...(revenue > 0 ? [{ label: "Revenue", value: money(revenue) }] : []),
          ]}
        />

        <div
          className="falorb-grid-2pane"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.9fr) minmax(260px, 1fr)",
            gap: "var(--space-6)",
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            {/*
              Flush body, padded header. `padding={0}` sets both, which leaves
              the title hard against the card's top-left corner.
            */}
            <Card
              title="Timeline"
              subtitle={`Most recent ${timeline.length} events, across every property`}
              bodyStyle={{ padding: "var(--space-5) 0 0" }}
            >
              {timeline.length === 0 ? (
                <Empty
                  dense
                  icon="clock"
                  title="No events in the retention window"
                  body="This profile exists, but its raw events have aged past the property's retention setting. Lifetime totals above are preserved."
                />
              ) : (
                <PersonTimeline
                  events={timeline.map((event) => ({
                    id: event.event_id,
                    timestamp: event.timestamp,
                    name: event.name,
                    path: event.path,
                    title: event.title,
                    project:
                      projectsById.get(event.project_id)?.domains[0] ??
                      projectsById.get(event.project_id)?.name ??
                      `project ${event.project_id}`,
                    projectSlug: projectsById.get(event.project_id)?.slug ?? null,
                    channel: event.channel,
                    country: event.country,
                    device: event.device_type,
                    durationMs: event.duration_ms,
                    revenue: event.revenue,
                  }))}
                  now={now}
                />
              )}
            </Card>

            <Card title="Properties used" subtitle="Where this person has been active">
              {usage.length === 0 ? (
                <Empty
                  dense
                  icon="globe"
                  title="No property activity recorded"
                  body="Their events have aged out of the retention window, or they were only ever seen on a property this workspace no longer tracks."
                />
              ) : (
                <div className="falorb-scroll-x">
                <div style={{ display: "grid", gap: 8 }}>
                  {usage.map((row) => {
                    const project = projectsById.get(row.project_id);
                    return (
                      <Link
                        key={row.project_id}
                        href={project ? `/p/${project.slug}` : "#"}
                        data-plain
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0,1.4fr) 80px 80px minmax(0,1.6fr)",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 12px",
                          borderRadius: "var(--radius-2)",
                          background: "var(--surface-raised)",
                          border: "1px solid var(--border-subtle)",
                          textDecoration: "none",
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            fontSize: "var(--size-body-sm)",
                            color: "var(--text-primary)",
                            minWidth: 0,
                          }}
                        >
                          <Icon name="globe" size={13} />
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {project?.domains[0] ?? project?.name ?? `project ${row.project_id}`}
                          </span>
                        </span>
                        <span style={figure}>{num(row.sessions)} ses</span>
                        <span style={figure}>{num(row.events)} ev</span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "var(--size-micro)",
                            color: "var(--text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.top_paths.slice(0, 2).join(" · ") || "—"}
                        </span>
                      </Link>
                    );
                  })}
                </div>
                </div>
              )}
            </Card>

            <Card
              title="Acquisition chain"
              subtitle="Every referrer and campaign that ever sent them, oldest first"
            >
              {acquisition.length === 0 ? (
                <Empty
                  dense
                  icon="route"
                  title="No acquisition touches recorded"
                  body="Every session started without a referrer or campaign — typical of direct traffic and bookmarked visits."
                />
              ) : (
                <div className="falorb-scroll-x">
                <div style={{ display: "grid", gap: 1 }}>
                  {acquisition.map((touch) => (
                    <div
                      key={touch.session_id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "104px 110px minmax(0,1fr) minmax(0,1fr)",
                        alignItems: "center",
                        gap: 12,
                        minHeight: "var(--row-height-dense)",
                        padding: "0 4px",
                        borderBottom: "1px solid var(--grid-line)",
                        fontSize: "var(--size-label)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--size-micro)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {shortDate(touch.started_at, now)}
                      </span>
                      <span style={{ color: "var(--text-body)" }}>{touch.channel || "Direct"}</span>
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
                        {touch.referrer_host || touch.source || "—"}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--size-micro)",
                          color: "var(--text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {touch.utm_campaign || touch.landing_path || "—"}
                      </span>
                    </div>
                  ))}
                </div>
                </div>
              )}
            </Card>
          </div>

          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Card title="Identity">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Person id" value={person.id} mono />
                {person.identifiedId && (
                  <Attribute label="Identified as" value={person.identifiedId} mono />
                )}
                {person.email && <Attribute label="Email" value={person.email} />}
                {person.name && <Attribute label="Name" value={person.name} />}
                <Attribute label="First seen" value={dateTime(person.firstSeenAt)} mono />
                <Attribute
                  label="Last seen"
                  value={`${relative(person.lastSeenAt, now)}`}
                  mono
                />
                {!person.identifiedId && (
                  <p
                    style={{
                      fontSize: "var(--size-micro)",
                      color: "var(--text-muted)",
                      lineHeight: "var(--lh-normal)",
                    }}
                  >
                    Anonymous. Calling identify() on your site attaches this history to a known
                    account retroactively — nothing is lost by them signing up later.
                  </p>
                )}
              </div>
            </Card>

            <CompanyResearchCard personId={person.id} company={company} />

            <Card title="Context" subtitle="Most recent observed">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Country" value={countryLabel(person.lastCountry)} />
                {person.lastCity && <Attribute label="City" value={person.lastCity} />}
                <Attribute label="Device" value={person.lastDeviceType ?? "—"} />
                <Attribute label="Browser" value={person.lastBrowser ?? "—"} />
                <Attribute label="OS" value={person.lastOs ?? "—"} />
              </div>
            </Card>

            <Card title="First touch" subtitle="Frozen at creation, never overwritten">
              <div style={{ display: "grid", gap: 10 }}>
                <Attribute label="Channel" value={person.firstChannel ?? "Direct"} />
                {person.firstReferrerHost && (
                  <Attribute label="Referrer" value={person.firstReferrerHost} mono />
                )}
                {person.firstUtmCampaign && (
                  <Attribute label="Campaign" value={person.firstUtmCampaign} mono />
                )}
                {person.firstLandingPath && (
                  <Attribute label="Landed on" value={person.firstLandingPath} mono />
                )}
              </div>
            </Card>

            <Card title="Interests" subtitle="Topics engaged with, time-decayed">
              {interests.length === 0 ? (
                <Empty
                  dense
                  icon="tag"
                  title="No topics scored yet"
                  body="Topics come from a content_tag property or the first path segment. Neither was present on the pages they read."
                />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {interests.map((interest) => (
                    <Tag key={interest.topic}>
                      {interest.topic}
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--size-micro)",
                          color: "var(--text-muted)",
                          marginLeft: 4,
                        }}
                      >
                        {num(interest.events)}
                      </span>
                    </Tag>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Devices and ids" subtitle={`${aliases.length} known`}>
              {aliases.length === 0 ? (
                <Empty
                  dense
                  icon="fingerprint"
                  title="No aliases recorded"
                  body="The identity worker writes these as sessions are processed. A very new profile may not have any yet."
                />
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {aliases.slice(0, 12).map((alias) => (
                    <div
                      key={alias.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}
                    >
                      <Badge tone={alias.kind === "device" ? "neutral" : "accent"}>
                        {alias.kind}
                      </Badge>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--size-micro)",
                          color: "var(--text-secondary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={alias.distinctId}
                      >
                        {alias.distinctId}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--size-micro)",
                          color: "var(--text-muted)",
                          flex: "0 0 auto",
                        }}
                      >
                        {projectsById.get(alias.projectId)?.slug ?? alias.projectId}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  );
}

const figure: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontFeatureSettings: "var(--tnum)",
  fontSize: "var(--size-micro)",
  color: "var(--text-body)",
  textAlign: "right",
};

function Attribute({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
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
      <span
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontSize: mono ? "var(--size-micro)" : "var(--size-body-sm)",
          color: "var(--text-body)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
