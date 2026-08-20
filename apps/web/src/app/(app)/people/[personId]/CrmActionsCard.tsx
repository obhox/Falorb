"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, Icon, Input, Select } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import {
  createLinkiContact,
  pushLinkiSignal,
  updateLinkiContact,
  type LinkedContactView,
} from "@/server/actions/crm";

const SIGNAL_TYPES = ["product_intent", "job_change", "funding", "hiring", "technology", "custom"];
const SIGNAL_LABELS: Record<string, string> = {
  product_intent: "Product intent",
  job_change: "Job change",
  funding: "Funding",
  hiring: "Hiring",
  technology: "Technology",
  custom: "Custom",
};

/**
 * Manual, per-person actions against Linki — create/update the linked
 * contact, or push a signal. Nothing here fires automatically; every button
 * is one explicit click for the one person on screen.
 */
export function CrmActionsCard({
  personId,
  connected,
  contact,
}: {
  personId: string;
  connected: boolean;
  contact: LinkedContactView | null;
}) {
  const { run, pending } = useAction();
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [signalType, setSignalType] = useState("product_intent");
  const [signalTitle, setSignalTitle] = useState("");

  if (!connected) {
    return (
      <Card title="Linki" subtitle="Sales & outreach">
        <p style={{ fontSize: "var(--size-body-sm)", color: "var(--text-secondary)", margin: 0 }}>
          Not connected.{" "}
          <Link href="/settings/integrations" style={{ color: "var(--text-primary)" }}>
            Connect Linki
          </Link>{" "}
          to create contacts or push signals from here.
        </p>
      </Card>
    );
  }

  if (!contact) {
    return (
      <Card title="Linki" subtitle="Not yet a contact in Linki">
        <div style={{ display: "grid", gap: 10 }}>
          <Input
            label="LinkedIn URL"
            value={linkedinUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/…"
            hint="Required — Linki has no contact without one."
          />
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !linkedinUrl.trim()}
            onClick={() => {
              const data = new FormData();
              data.set("linkedin_url", linkedinUrl);
              void run(() => createLinkiContact(personId, data), {
                success: "Contact created in Linki.",
              }).then((result) => {
                if (result?.ok) setLinkedinUrl("");
              });
            }}
          >
            {pending ? "Creating…" : "Create contact in Linki"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Linki"
      subtitle="Linked contact"
      action={<Badge tone="neutral">{contact.email ?? contact.fullName ?? "linked"}</Badge>}
    >
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 4 }}>
          {contact.fullName && (
            <span style={{ fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>
              {contact.fullName}
            </span>
          )}
          {contact.company && (
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              {contact.company}
            </span>
          )}
          <Button
            size="sm"
            iconLeft={<Icon name="refresh-cw" size={12} />}
            disabled={pending}
            onClick={() =>
              void run(() => updateLinkiContact(personId), { success: "Updated from Falorb." })
            }
          >
            {pending ? "Updating…" : "Update from Falorb"}
          </Button>
        </div>

        <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border-subtle)", paddingTop: 14 }}>
          <span
            style={{
              fontSize: "var(--size-label)",
              color: "var(--text-secondary)",
              fontWeight: "var(--wt-medium)",
            }}
          >
            Push a signal
          </span>
          <Select
            size="sm"
            value={SIGNAL_LABELS[signalType] ?? signalType}
            options={SIGNAL_TYPES.map((t) => SIGNAL_LABELS[t] ?? t)}
            onChange={(label: string) => {
              const type = SIGNAL_TYPES.find((t) => SIGNAL_LABELS[t] === label);
              if (type) setSignalType(type);
            }}
          />
          <Input
            value={signalTitle}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSignalTitle(e.target.value)}
            placeholder="e.g. Viewed pricing 3x this week"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={pending || !signalTitle.trim()}
            onClick={() => {
              const data = new FormData();
              data.set("type", signalType);
              data.set("title", signalTitle);
              void run(() => pushLinkiSignal(personId, data), {
                success: "Signal pushed to Linki.",
              }).then((result) => {
                if (result?.ok) setSignalTitle("");
              });
            }}
          >
            {pending ? "Pushing…" : "Push signal"}
          </Button>
          <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", margin: 0 }}>
            Linki's own signal rules decide whether this enrolls them in a live workflow.
          </p>
        </div>
      </div>
    </Card>
  );
}
