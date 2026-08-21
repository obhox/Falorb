import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon } from "@falorb/ui";
import { requireSession } from "@/server/session";
import { isLinkiConnected } from "@/server/actions/crm";
import { listContactsPaginated } from "@/server/crm";
import { PageBody, PageHeader } from "@/components/shell/PageHeader";
import { Pager } from "@/components/Pager";
import { Empty } from "@/components/Empty";
import { one, type SearchParams } from "@/lib/range";
import { ContactsFilters } from "./ContactsFilters";
import { ContactsTable } from "./ContactsTable";

export const metadata: Metadata = { title: "Linki contacts" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The full, paginated Linki contacts mirror — every `crmContacts` row, not
 * just the unmatched backlog the "From Linki" tab shows. Reachable from
 * there via a "View all contacts" link.
 */
export default async function CrmContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requireSession();
  const orgId = session.workspace.organizationId;
  const search = await searchParams;

  const connected = await isLinkiConnected(orgId);
  if (!connected) {
    return (
      <>
        <PageHeader title="Linki contacts" />
        <PageBody>
          <Empty
            icon="plug"
            title="Linki isn't connected"
            body="Connect it to see synced contacts here."
            action={
              <Link href="/settings/integrations" style={{ textDecoration: "none" }}>
                Connect in Settings → Integrations
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  const term = one(search, "q") ?? "";
  const filter = one(search, "filter") === "unmatched" ? "unmatched" : "all";
  const page = Math.max(1, Number(one(search, "page") ?? 1) || 1);

  const result = await listContactsPaginated({
    organizationId: orgId,
    search: term,
    filter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Linki contacts"
        meta={`${result.total} synced`}
        actions={
          <Link href="/crm" style={{ textDecoration: "none" }}>
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
              CRM
            </span>
          </Link>
        }
      />
      <PageBody>
        <ContactsFilters search={term} filter={filter} total={result.total} />

        <Card tone="panel" padding={0}>
          <ContactsTable
            contacts={result.rows.map((c) => ({
              id: c.id,
              fullName: c.fullName,
              email: c.email,
              company: c.company,
              title: c.title,
              personId: c.personId,
              syncedAt: c.syncedAt.toISOString(),
            }))}
            now={now}
            emptyBody={
              term
                ? "Nothing matched. Clear the search to see every synced contact."
                : "Nothing has synced from Linki yet."
            }
          />
        </Card>

        <Pager page={page} hasMore={result.hasMore} total={result.total} pageSize={PAGE_SIZE} />
      </PageBody>
    </>
  );
}
