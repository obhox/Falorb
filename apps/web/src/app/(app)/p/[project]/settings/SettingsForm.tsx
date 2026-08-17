"use client";

import { useState } from "react";
import { Button, Card, Checkbox, Icon, Input, Select, Switch } from "@falorb/ui";
import { updateProjectSettings } from "@/server/actions/project";
import { useAction } from "@/lib/use-action";

/**
 * Property settings.
 *
 * The design system's form controls are controlled React components rather
 * than native inputs, so they do not participate in a plain form submission.
 * State is held here and assembled into a `FormData` on submit — the server
 * action's contract is unchanged, and the same action is reachable without
 * JavaScript-specific assumptions.
 */

const IDENTITY_LABELS = {
  org: "Across all properties",
  project: "This property only",
} as const;

const CONSENT_LABELS = {
  off: "Collect immediately",
  opt_in: "Wait for consent",
  opt_out: "Collect until withdrawn",
} as const;

export interface ProjectSettings {
  slug: string;
  name: string;
  domains: string[];
  timezone: string;
  identityScope: "project" | "org";
  consentMode: "off" | "opt_in" | "opt_out";
  cookieless: boolean;
  retentionDays: number;
}

export function SettingsForm({
  project,
  canEdit,
}: {
  project: ProjectSettings;
  canEdit: boolean;
}) {
  const { run, pending } = useAction();

  const [name, setName] = useState(project.name);
  const [domains, setDomains] = useState(project.domains.join(", "));
  const [timezone, setTimezone] = useState(project.timezone);
  const [retention, setRetention] = useState(String(project.retentionDays));
  const [identity, setIdentity] = useState(project.identityScope);
  const [consent, setConsent] = useState(project.consentMode);
  const [cookieless, setCookieless] = useState(project.cookieless);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const data = new FormData();
    data.set("name", name);
    data.set("domains", domains);
    data.set("timezone", timezone);
    data.set("retention_days", retention);
    data.set("identity_scope", identity);
    data.set("consent_mode", consent);
    if (cookieless) data.set("cookieless", "on");

    // The action returns its own "Saved", which `run` shows in preference to
    // any fallback here.
    await run(() => updateProjectSettings(project.slug, data));
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-6)" }}>
      <Card title="Tracking" subtitle="What this property is, and where it may report from">
        <div style={{ display: "grid", gap: "var(--space-7)" }}>
          <Input
            label="Name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            hint="Shown in the sidebar and the portfolio list."
          />

          <Input
            label="Domains"
            value={domains}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomains(e.target.value)}
            mono
            placeholder="falorb.io, docs.falorb.io"
            hint="Events from any other origin are rejected at the edge, before the ingest queue. An apex domain authorises its subdomains."
          />

          <Input
            label="Timezone"
            value={timezone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTimezone(e.target.value)}
            mono
            placeholder="UTC"
            hint="The zone that “today” is computed against in reports."
          />

          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: "var(--size-label)",
                color: "var(--text-secondary)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              Identity scope
            </span>
            <Select
              value={IDENTITY_LABELS[identity]}
              options={Object.values(IDENTITY_LABELS)}
              onChange={(label: string) => {
                const entry = Object.entries(IDENTITY_LABELS).find(([, l]) => l === label);
                if (entry) setIdentity(entry[0] as ProjectSettings["identityScope"]);
              }}
            />
            <span style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)" }}>
              Unifying across properties is what makes a person&apos;s history readable end to end.
              Only deterministic signals join people — a shared identify() call, never
              fingerprinting.
            </span>
          </div>
        </div>
      </Card>

      <Card title="Privacy" subtitle="Raw IP addresses are never stored, in any configuration">
        <div style={{ display: "grid", gap: "var(--space-7)" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: "var(--size-label)",
                color: "var(--text-secondary)",
                fontWeight: "var(--wt-medium)",
              }}
            >
              Consent mode
            </span>
            <Select
              value={CONSENT_LABELS[consent]}
              options={Object.values(CONSENT_LABELS)}
              onChange={(label: string) => {
                const entry = Object.entries(CONSENT_LABELS).find(([, l]) => l === label);
                if (entry) setConsent(entry[0] as ProjectSettings["consentMode"]);
              }}
            />
            <span style={{ fontSize: "var(--size-micro)", color: "var(--signal-warn)" }}>
              The tracker honours this setting. Server-side enforcement is not implemented yet, so
              a client that ignores the setting is not currently blocked at ingest.
            </span>
          </div>

          <Switch
            checked={cookieless}
            onChange={setCookieless}
            label="Cookieless mode"
          />
          <span
            style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", marginTop: -10 }}
          >
            No cookie and no localStorage entry. Identity becomes a daily-rotating salted hash, so
            an anonymous visitor is not recognised across a day boundary.
          </span>

          <Input
            label="Retention"
            value={retention}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRetention(e.target.value)}
            mono
            suffix="days"
            hint="Raw events are deleted past this age by the retention worker. Rollups survive; the event rows do not."
          />
        </div>
      </Card>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {canEdit ? (
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving" : "Save changes"}
          </Button>
        ) : (
          <span style={{ fontSize: "var(--size-label)", color: "var(--text-muted)" }}>
            Read-only — an owner or admin can change these settings.
          </span>
        )}
      </div>
    </form>
  );
}
