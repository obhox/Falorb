import "server-only";
import { and, arrayOverlaps, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@falorb/db";

/**
 * The people list, read from Postgres rather than ClickHouse.
 *
 * Both stores can answer "who are my people", and they answer different
 * questions. ClickHouse's `personList` aggregates events inside a date range —
 * the right tool for "who was active last week". The `persons` table is the
 * control plane's profile: identity, email, company, lead score, lifetime
 * totals, maintained by the sessionizer. Searching by email, filtering to
 * identified people and sorting by lead score are all indexed operations here
 * and none of them are expressible against the event stream.
 *
 * Tenancy is enforced on `organization_id`, which is on the row itself, so a
 * person from another organization cannot be reached by guessing a UUID.
 */

export type PersonRow = typeof schema.persons.$inferSelect;

/** A person plus the company their network resolved to, if any. */
export interface PersonListRow {
  person: PersonRow;
  companyName: string | null;
  companyDomain: string | null;
}

export interface PeopleQuery {
  organizationId: string;
  /** Restrict to people seen on these projects. Empty means all of them. */
  projectIds?: number[];
  /** Matches email, name or the id supplied to identify(). */
  search?: string;
  identifiedOnly?: boolean;
  limit?: number;
  offset?: number;
  sort?: "recent" | "lead_score" | "events";
}

export interface PeoplePage {
  people: PersonListRow[];
  /** True when more rows exist past this page. */
  hasMore: boolean;
  total: number;
}

export async function listPeople(query: PeopleQuery): Promise<PeoplePage> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = Math.max(query.offset ?? 0, 0);

  const conditions = [
    eq(schema.persons.organizationId, query.organizationId),
    // Erased profiles are tombstoned rather than deleted, so they must be
    // excluded explicitly or a GDPR erasure would appear not to have worked.
    isNull(schema.persons.deletedAt),
  ];

  if (query.projectIds?.length) {
    conditions.push(arrayOverlaps(schema.persons.projectIds, query.projectIds));
  }

  if (query.identifiedOnly) {
    conditions.push(isNotNull(schema.persons.identifiedId));
  }

  const term = query.search?.trim();
  if (term) {
    // Parameterised by drizzle; the wildcards are added around the bound value,
    // never concatenated into the statement.
    const pattern = `%${term}%`;
    conditions.push(
      or(
        ilike(schema.persons.email, pattern),
        ilike(schema.persons.name, pattern),
        ilike(schema.persons.identifiedId, pattern),
      )!,
    );
  }

  const where = and(...conditions);

  const orderBy =
    query.sort === "lead_score"
      ? [desc(schema.persons.leadScore), desc(schema.persons.lastSeenAt)]
      : query.sort === "events"
        ? [desc(schema.persons.totalEvents), desc(schema.persons.lastSeenAt)]
        : [desc(schema.persons.lastSeenAt)];

  const database = db();

  const [rows, [counted]] = await Promise.all([
    database
      .select({
        person: schema.persons,
        companyName: schema.companies.name,
        companyDomain: schema.companies.domain,
      })
      .from(schema.persons)
      // Left join: most people never resolve to a company, and an inner join
      // would quietly drop every anonymous consumer visitor from the list.
      .leftJoin(schema.companies, eq(schema.companies.id, schema.persons.companyId))
      .where(where)
      .orderBy(...orderBy)
      // One extra row is the cheapest possible "is there a next page" check —
      // it avoids a second COUNT over the same predicate for pagination.
      .limit(limit + 1)
      .offset(offset),
    database
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.persons)
      .where(where),
  ]);

  return {
    people: rows.slice(0, limit),
    hasMore: rows.length > limit,
    total: counted?.total ?? 0,
  };
}

export interface PersonDetail {
  person: PersonRow;
  company: typeof schema.companies.$inferSelect | null;
  aliases: (typeof schema.personAliases.$inferSelect)[];
}

/** One person, or null if they do not belong to this organization. */
export async function getPerson(
  organizationId: string,
  personId: string,
): Promise<PersonDetail | null> {
  // A malformed id would otherwise reach Postgres as an invalid uuid literal
  // and throw rather than 404.
  if (!isUuid(personId)) return null;

  const database = db();

  const [person] = await database
    .select()
    .from(schema.persons)
    .where(
      and(
        eq(schema.persons.id, personId),
        eq(schema.persons.organizationId, organizationId),
        isNull(schema.persons.deletedAt),
      ),
    )
    .limit(1);

  if (!person) return null;

  const [company, aliases] = await Promise.all([
    person.companyId
      ? database
          .select()
          .from(schema.companies)
          .where(eq(schema.companies.id, person.companyId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    database
      .select()
      .from(schema.personAliases)
      .where(eq(schema.personAliases.personId, person.id))
      .orderBy(desc(schema.personAliases.lastSeenAt)),
  ]);

  return { person, company, aliases };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
