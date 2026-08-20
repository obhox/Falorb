"use client";

import { Button, Card, Icon } from "@falorb/ui";
import { useAction } from "@/lib/use-action";
import { enrichCompany } from "@/server/actions/company-research";

export interface CompanyResearchView {
  name: string | null;
  domain: string;
  industry: string | null;
  employeeRange: string | null;
  linkedinUrl: string | null;
}

const ASN_PLACEHOLDER = /^as\d+$/i;

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
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

/**
 * The person profile's "Company" card, replacing the plain read-only
 * version. The automatic ASN-based enrichment job only ever learns a
 * network operator's registered name — it has no way to know what the
 * company does, how big it is, or its LinkedIn presence. "Research this
 * company" fills those in on demand via Exa (search) + Firecrawl (scrape
 * the company's own site). Not rendered at all for an ASN-only placeholder
 * company (`as12345`), since there's no real domain yet to research.
 */
export function CompanyResearchCard({
  personId,
  company,
}: {
  personId: string;
  company: CompanyResearchView | null;
}) {
  const { run, pending } = useAction();

  if (!company || ASN_PLACEHOLDER.test(company.domain)) return null;

  const hasProfile = Boolean(company.industry || company.employeeRange || company.linkedinUrl);

  return (
    <Card title="Company" subtitle={company.name ?? "Resolved from the network operator"}>
      <div style={{ display: "grid", gap: 10 }}>
        <Field label="Domain" value={company.domain} mono />
        {company.name && <Field label="Name" value={company.name} />}
        {company.industry && <Field label="Industry" value={company.industry} />}
        {company.employeeRange && <Field label="Employees" value={company.employeeRange} mono />}
        {company.linkedinUrl && <Field label="LinkedIn" value={company.linkedinUrl} mono />}

        {!hasProfile && (
          <p style={{ fontSize: "var(--size-micro)", color: "var(--text-muted)", margin: 0 }}>
            No industry, size, or LinkedIn on file yet — only what the ASN identified.
          </p>
        )}

        <Button
          size="sm"
          iconLeft={<Icon name="search" size={12} />}
          disabled={pending}
          onClick={() =>
            void run(() => enrichCompany(personId), {
              success: "Company profile updated from web research.",
            })
          }
        >
          {pending ? "Researching…" : hasProfile ? "Refresh from web" : "Research this company"}
        </Button>
      </div>
    </Card>
  );
}
