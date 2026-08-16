import { Card } from "@falorb/ui";
import { requireProject } from "@/server/session";
import { listPeople } from "@/server/people";
import { PageBody } from "@/components/shell/PageHeader";
import { PeopleFilters } from "@/components/PeopleFilters";
import { PeopleTable, type PersonListItem } from "@/components/PeopleTable";
import { Pager } from "@/components/Pager";
import { personLabel } from "@/lib/format";
import { one, type SearchParams } from "@/lib/range";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * People seen on one property.
 *
 * Scoped by `projectIds` rather than by the URL slug directly: the project was
 * already resolved against the session, so the query cannot reach a property
 * the caller does not own.
 */
export default async function ProjectPeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { session, project } = await requireProject((await params).project);
  const search = await searchParams;

  const term = one(search, "q") ?? "";
  const identifiedOnly = one(search, "identified") === "1";
  const sort = asSort(one(search, "sort"));
  const page = Math.max(1, Number(one(search, "page") ?? 1) || 1);

  const result = await listPeople({
    organizationId: session.workspace.organizationId,
    projectIds: [project.id],
    search: term,
    identifiedOnly,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // One clock for the whole render, so every "41m ago" agrees.
  const now = Date.now();

  const rows: PersonListItem[] = result.people.map(({ person, companyName, companyDomain }) => ({
    id: person.id,
    label:
      person.email ??
      person.name ??
      person.identifiedId ??
      personLabel(person.id),
    identified: person.identifiedId != null,
    email: person.email,
    company: companyName ?? companyDomain,
    country: person.lastCountry,
    device: person.lastDeviceType,
    sessions: person.totalSessions,
    events: person.totalEvents,
    leadScore: person.leadScore,
    firstSeen: person.firstSeenAt.toISOString(),
    lastSeen: person.lastSeenAt.toISOString(),
  }));

  return (
    <PageBody>
      <PeopleFilters
        search={term}
        identifiedOnly={identifiedOnly}
        sort={sort}
        total={result.total}
      />

      <Card tone="panel" padding={0}>
        <PeopleTable
          people={rows}
          now={now}
          emptyBody={
            term || identifiedOnly
              ? "Nothing matched. Clear the search, or untick “Identified only” to include anonymous visitors."
              : "Nobody has been recorded on this property yet. Check that the snippet is installed on its settings tab."
          }
        />
      </Card>

      <Pager page={page} hasMore={result.hasMore} total={result.total} pageSize={PAGE_SIZE} />
    </PageBody>
  );
}

function asSort(value: string | undefined): "recent" | "lead_score" | "events" {
  return value === "lead_score" || value === "events" ? value : "recent";
}
