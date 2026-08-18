"use client";

import { useState } from "react";
import { Badge, Button, Card, Input } from "@falorb/ui";
import { CopyField } from "@/components/CopyField";
import { clearLinkDomain, setLinkDomain } from "@/server/actions/referrals";
import { useAction } from "@/lib/use-action";

export interface BrandedDomainView {
  domain: string | null;
  target: string;
  verified: boolean;
  error?: string;
}

/**
 * Let referral links resolve on the property's own domain instead of the
 * shared Falorb app domain.
 *
 * This only records the domain and checks its DNS — it cannot provision TLS
 * or register the domain with whatever hosts this app, since that step
 * happens on a platform this code has no access to. The copy says so plainly
 * rather than implying "saved" means "live".
 */
export function BrandedDomainCard({ slug, status }: { slug: string; status: BrandedDomainView }) {
  const { run, pending } = useAction();
  const [domain, setDomain] = useState("");

  async function save() {
    const data = new FormData();
    data.set("domain", domain);
    const result = await run(() => setLinkDomain(slug, data));
    if (result?.ok) setDomain("");
  }

  async function clear() {
    await run(() => clearLinkDomain(slug));
  }

  if (!status.domain) {
    return (
      <Card
        title="Branded domain"
        subtitle="Optional — resolve referral links on your own domain instead of the shared one"
      >
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <Input
              label="Domain"
              mono
              value={domain}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomain(e.target.value)}
              placeholder="go.acme.example"
            />
          </div>
          <Button variant="primary" onClick={save} disabled={pending || !domain}>
            {pending ? "Saving" : "Save"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Branded domain"
      subtitle="Referral links resolve here once DNS is verified"
      action={<Badge tone={status.verified ? "up" : "warn"} dot>{status.verified ? "verified" : "pending"}</Badge>}
    >
      <div style={{ display: "grid", gap: "var(--space-5)" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--size-body-sm)", color: "var(--text-primary)" }}>
          {status.domain}
        </div>

        {!status.verified && (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <p style={{ fontSize: "var(--size-label)", color: "var(--text-secondary)" }}>
              Add a CNAME record for <code>{status.domain}</code> pointing at the target below, then
              come back — this checks automatically on reload. Your hosting platform also needs this
              domain added on its side to issue a certificate for it; adding the CNAME alone is not
              enough for a browser to trust it over HTTPS.
            </p>
            <CopyField label="CNAME target" value={status.target} />
          </div>
        )}

        <div>
          <Button size="sm" variant="secondary" onClick={clear} disabled={pending}>
            Remove
          </Button>
        </div>
      </div>
    </Card>
  );
}
