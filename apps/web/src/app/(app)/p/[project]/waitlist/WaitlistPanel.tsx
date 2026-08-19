"use client";

import { Button, Card, Icon } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { Empty } from "@/components/Empty";
import { useAction } from "@/lib/use-action";
import { shortDate } from "@/lib/format";
import { disableProjectWaitlist, enableProjectWaitlist } from "@/server/actions/waitlist";

export interface WaitlistEntryRow {
  id: string;
  email: string;
  name: string | null;
  position: number;
  referralCount: number;
  createdAt: string;
}

/**
 * Owner-facing waitlist: the enable flow when it's off, the join link and
 * ranked entries once it's on.
 *
 * Position and referral count are read directly off `listWaitlistWithPositions`
 * — nothing here re-derives rank client-side, so the list always agrees with
 * what an entrant sees on their own join page.
 */
export function WaitlistPanel({
  slug,
  enabled,
  joinUrl,
  entries,
}: {
  slug: string;
  enabled: boolean;
  joinUrl: string | null;
  entries: WaitlistEntryRow[];
}) {
  const { run, pending } = useAction();

  async function enable() {
    await run(() => enableProjectWaitlist(slug), { quiet: true });
  }

  async function disable() {
    await run(() => disableProjectWaitlist(slug), { success: "Waitlist turned off." });
  }

  if (!enabled || !joinUrl) {
    return (
      <Card>
        <Empty
          icon="list-ordered"
          title="Waitlist is off"
          body="Turn it on to get a public join link — signing up moves people up the queue by inviting others."
          action={
            <Button size="sm" variant="primary" disabled={pending} onClick={enable}>
              {pending ? "Turning on" : "Enable waitlist"}
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Join link"
        subtitle="Share this anywhere — embed it, link it, or post it directly"
        action={
          <Button size="sm" disabled={pending} onClick={disable}>
            {pending ? "Turning off" : "Turn off"}
          </Button>
        }
      >
        <CopyField value={joinUrl} />
      </Card>

      <Card title="Entrants" subtitle={`${entries.length} on the list, ranked by position`}>
        {entries.length === 0 ? (
          <Empty
            icon="users"
            title="No one has joined yet"
            body="Share the join link above — the first entrants will appear here."
          />
        ) : (
          <div className="falorb-scroll-x">
            <div style={{ display: "grid", gap: 1 }}>
              <div style={headerRow}>
                <span>#</span>
                <span>Email</span>
                <span>Name</span>
                <span style={{ textAlign: "right" }}>Referrals</span>
                <span style={{ textAlign: "right" }}>Joined</span>
              </div>

              {entries.map((entry) => (
                <div key={entry.id} style={bodyRow}>
                  <span style={figure}>{entry.position}</span>
                  <span
                    style={{
                      fontSize: "var(--size-body-sm)",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.email}
                  </span>
                  <span
                    style={{
                      fontSize: "var(--size-body-sm)",
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.name ?? "—"}
                  </span>
                  <span style={figure}>
                    {entry.referralCount > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                        <Icon name="arrow-up" size={11} />
                        {entry.referralCount}
                      </span>
                    )}
                    {entry.referralCount === 0 && "—"}
                  </span>
                  <span style={{ ...figure, color: "var(--text-muted)" }}>
                    {shortDate(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

const headerRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "48px minmax(0,1.4fr) minmax(0,1fr) 90px 90px",
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

const bodyRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "48px minmax(0,1.4fr) minmax(0,1fr) 90px 90px",
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
