"use client";

import { useState } from "react";
import { Button, Card, Dialog, Icon, IconButton, Input } from "@falorb/ui";
import { Empty } from "@/components/Empty";
import { useToast } from "@/components/Toast";
import { createReferralLink, revokeReferralLink } from "@/server/actions/referrals";
import { useAction } from "@/lib/use-action";
import { num, pct } from "@/lib/format";

export interface ReferralLinkView {
  id: string;
  label: string;
  code: string;
  url: string;
  active: boolean;
  clicks: number;
  visitors: number;
  conversions: number;
  conversionRate: number;
}

/**
 * Referral links and their attribution.
 *
 * A revoked link stays listed, dimmed rather than removed — its historical
 * performance is exactly what the leaderboard exists to show, and a link that
 * vanished when turned off would look deleted, not paused.
 */
export function ReferralsPanel({ slug, links }: { slug: string; links: ReferralLinkView[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const toast = useToast();

  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");

  async function submit() {
    const data = new FormData();
    data.set("label", label);
    data.set("code", code);
    data.set("destinationUrl", destinationUrl);

    const result = await run(() => createReferralLink(slug, data), { success: "Referral link created" });
    if (!result?.ok) return;

    setOpen(false);
    setLabel("");
    setCode("");
    setDestinationUrl("");
  }

  async function revoke(linkId: string, linkLabel: string) {
    await run(() => revokeReferralLink(slug, linkId), { success: `"${linkLabel}" revoked` });
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy — select and copy the link manually.");
    }
  }

  return (
    <>
      <Card
        title="Referral links"
        subtitle="Clicks and eventual sign-ups, by link"
        action={
          <Button
            size="sm"
            variant="primary"
            iconLeft={<Icon name="plus" size={13} />}
            onClick={() => setOpen(true)}
          >
            New link
          </Button>
        }
      >
        {links.length === 0 ? (
          <Empty
            icon="link"
            title="No referral links yet"
            body="Create a link to hand out — on a business card, in a podcast, wherever — and see who it brings in."
            action={
              <Button size="sm" onClick={() => setOpen(true)}>
                Create the first link
              </Button>
            }
          />
        ) : (
          <div className="falorb-scroll-x">
          <div style={{ display: "grid", gap: 1 }}>
            <div style={headerRow}>
              <span>Link</span>
              <span style={{ textAlign: "right" }}>Clicks</span>
              <span style={{ textAlign: "right" }}>Visitors</span>
              <span style={{ textAlign: "right" }}>Conversions</span>
              <span style={{ textAlign: "right" }}>Rate</span>
              <span />
              <span />
            </div>

            {links.map((link) => (
              <div key={link.id} style={{ ...bodyRow, opacity: link.active ? 1 : 0.5 }}>
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
                    {link.label}
                    {!link.active && (
                      <span style={{ color: "var(--text-muted)" }}> · revoked</span>
                    )}
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
                    {link.url}
                  </span>
                </span>
                <span style={figure}>{num(link.clicks)}</span>
                <span style={figure}>{num(link.visitors)}</span>
                <span style={figure}>{num(link.conversions)}</span>
                <span style={figure}>{pct(link.conversionRate)}</span>
                <IconButton
                  size="sm"
                  label={`Copy ${link.label}'s link`}
                  icon={<Icon name="copy" size={13} />}
                  onClick={() => copy(link.url)}
                />
                <IconButton
                  size="sm"
                  label={`Revoke ${link.label}`}
                  icon={<Icon name="trash-2" size={13} />}
                  disabled={pending || !link.active}
                  onClick={() => revoke(link.id, link.label)}
                />
              </div>
            ))}
          </div>
          </div>
        )}
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New referral link"
        subtitle="A link you hand out yourself — attribution follows it from click to sign-up"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={pending}>
              {pending ? "Creating" : "Create link"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <Input
            label="Label"
            value={label}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
            placeholder="Podcast appearance — Acme Weekly"
          />

          <Input
            label="Code"
            mono
            value={code}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
            placeholder="acme-weekly"
            hint="Leave blank to generate one from the label. Shows up in the URL, so keep it short."
          />

          <Input
            label="Destination"
            mono
            value={destinationUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDestinationUrl(e.target.value)}
            placeholder="https://acme.example/launch"
            hint="Leave blank to send people to this property's homepage."
          />
        </div>
      </Dialog>
    </>
  );
}

const headerRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1.6fr) 90px 90px 110px 80px 34px 34px",
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
  gridTemplateColumns: "minmax(0,1.6fr) 90px 90px 110px 80px 34px 34px",
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
