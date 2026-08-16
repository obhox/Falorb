import type { Metadata } from "next";
import { Card } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { ALERT_KIND_LABELS, describeCondition, listAlerts, type AlertKind } from "@/server/alerts";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { AlertsPanel, type AlertView } from "./AlertsPanel";
import { Empty } from "@/components/Empty";
import { dateTime, relative } from "@/lib/format";

export const metadata: Metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

/**
 * Alert rules and recent firings.
 *
 * Delivery is worth being precise about: Slack and generic webhooks are wired
 * and verified, email is not. A rule whose only channel is email will evaluate
 * and record a firing, and nothing will arrive. That is stated on the page
 * rather than left to be discovered during an outage.
 */
export default async function AlertsPage() {
  const session = await requireSession();
  const alerts = await listAlerts(session.workspace.organizationId);
  const now = Date.now();

  const views: AlertView[] = alerts.map(({ alert, projectName, recent }) => ({
    id: alert.id,
    name: alert.name,
    kind: alert.kind,
    kindLabel: ALERT_KIND_LABELS[alert.kind as AlertKind] ?? alert.kind,
    description: describeCondition(alert),
    scope: projectName ?? "All properties",
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
        <AlertsPanel
          alerts={views}
          projects={session.projects.map((p) => ({ slug: p.slug, name: p.name }))}
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
          )}
        </Card>

        <Card title="Delivery" subtitle="What is wired, and what is not">
          <p
            style={{
              fontSize: "var(--size-body-sm)",
              color: "var(--text-body)",
              lineHeight: "var(--lh-normal)",
              maxWidth: "66ch",
            }}
          >
            Slack and generic webhook channels deliver. Email does not — no mailer is configured,
            so an email channel records the firing and sends nothing. Configure a Slack or webhook
            channel for anything you need to actually reach you.
          </p>
        </Card>
      </PageBody>
    </>
  );
}
