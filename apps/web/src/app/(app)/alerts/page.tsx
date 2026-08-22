import type { Metadata } from "next";
import { Card } from "@falorb/ui";
import { requireSession } from "@/server/session";
import {
  ALERT_KIND_LABELS,
  describeCondition,
  listAlerts,
  listChannels,
  type AlertKind,
} from "@/server/alerts";
import { listAssignees } from "@/server/agents";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { AlertsPanel, type AlertView } from "./AlertsPanel";
import { ChannelsPanel, type ChannelView } from "./ChannelsPanel";
import { can } from "@falorb/db";
import { Empty } from "@/components/Empty";
import { dateTime, relative } from "@/lib/format";

export const metadata: Metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

/**
 * Alert rules and recent firings.
 *
 * Channels come first, then rules. A rule with no channel is not an alert: the
 * worker evaluates it and writes the result to its own stdout, which nobody is
 * watching. Creating one therefore requires picking a channel, and any existing
 * rule without one is labelled "delivers nowhere" rather than looking healthy.
 */
export default async function AlertsPage() {
  const session = await requireSession();
  const [alerts, channels, assignees] = await Promise.all([
    listAlerts(session.workspace.organizationId),
    listChannels(session.workspace.organizationId),
    listAssignees(session.workspace.organizationId),
  ]);
  const agentsById = new Map(assignees.agents.map((a) => [a.id, a]));
  const now = Date.now();

  // Whether a mailer exists decides if an email channel actually delivers, so
  // it is surfaced rather than discovered during an outage.
  const emailConfigured = Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL);

  const ruleCounts = new Map<string, number>();
  for (const { alert } of alerts) {
    if (alert.channelId) ruleCounts.set(alert.channelId, (ruleCounts.get(alert.channelId) ?? 0) + 1);
  }

  const channelViews: ChannelView[] = channels.map((channel) => {
    const config = channel.config as Record<string, string>;
    return {
      id: channel.id,
      name: channel.name,
      kind: channel.kind,
      // Never the signing secret — only where it points.
      destination:
        channel.kind === "email"
          ? (config.to ?? "—")
          : channel.kind === "agent"
            ? (config.agentId && agentsById.get(config.agentId)?.name) || "Unknown agent"
            : (config.url ?? "—"),
      active: channel.active,
      ruleCount: ruleCounts.get(channel.id) ?? 0,
    };
  });

  const views: AlertView[] = alerts.map(({ alert, projectName, channelName, recent }) => ({
    id: alert.id,
    name: alert.name,
    kind: alert.kind,
    kindLabel: ALERT_KIND_LABELS[alert.kind as AlertKind] ?? alert.kind,
    description: describeCondition(alert),
    scope: projectName ?? "All properties",
    channelName: channelName ?? null,
    active: alert.active,
    cooldownMinutes: alert.cooldownMinutes,
    lastFiredAt: alert.lastFiredAt?.toISOString() ?? null,
    lastEvaluatedAt: alert.lastEvaluatedAt?.toISOString() ?? null,
    recent: recent.map((event) => ({
      id: event.id,
      status: event.status,
      message: event.message,
      createdAt: event.createdAt.toISOString(),
    })),
  }));

  const history = alerts
    .flatMap(({ alert, recent }) => recent.map((event) => ({ alert, event })))
    .sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime())
    .slice(0, 25);

  return (
    <>
      <PageHeader
        title="Alerts"
        meta={`${views.filter((v) => v.active).length} active of ${views.length}`}
      />

      <PageBody>
        <ChannelsPanel
          channels={channelViews}
          canEdit={can.writeAnalysis(session.workspace.role)}
          emailConfigured={emailConfigured}
          agents={assignees.agents.map((a) => ({ id: a.id, name: a.name, roleTitle: a.roleTitle }))}
        />

        <AlertsPanel
          alerts={views}
          projects={session.projects.map((p) => ({ slug: p.slug, name: p.name }))}
          channels={channels.map((c) => ({ id: c.id, name: c.name }))}
          now={now}
        />

        <Card title="Recent firings" subtitle="Every notification, so a noisy rule is visible">
          {history.length === 0 ? (
            <Empty
              dense
              icon="bell-off"
              title="Nothing has fired"
              body="Either no rule has breached, or no rule is active yet."
            />
          ) : (
            <div className="falorb-scroll-x">
            <div style={{ display: "grid", gap: 1 }}>
              {history.map(({ alert, event }) => (
                <div
                  key={event.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 90px minmax(0,1fr) 120px",
                    alignItems: "center",
                    gap: 12,
                    minHeight: "var(--row-height-dense)",
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
                    {relative(event.createdAt, now)}
                  </span>
                  <span
                    style={{
                      fontSize: "var(--size-micro)",
                      color:
                        event.status === "fired"
                          ? "var(--signal-warn)"
                          : event.status === "error"
                            ? "var(--signal-down)"
                            : "var(--signal-up)",
                    }}
                  >
                    {event.status}
                  </span>
                  <span
                    style={{
                      color: "var(--text-body)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={event.message ?? undefined}
                  >
                    {event.message ?? alert.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--size-micro)",
                      color: event.deliveredAt ? "var(--text-muted)" : "var(--signal-down)",
                      textAlign: "right",
                    }}
                    title={event.deliveryError ?? undefined}
                  >
                    {event.deliveredAt ? `sent ${dateTime(event.deliveredAt)}` : "not delivered"}
                  </span>
                </div>
              ))}
            </div>
            </div>
          )}
        </Card>

      </PageBody>
    </>
  );
}
