import { eq, inArray, sql } from "drizzle-orm";
import { chDateTime, schema, type WorkerContext } from "../context";
import type { Watermarks } from "../scheduler";

/**
 * B2B company identification, keyed on ASN rather than IP address.
 *
 * The plan called for an IP -> company lookup, which would have meant either
 * calling a provider synchronously on the ingest hot path, or shipping raw IP
 * addresses to a queue for a worker to resolve later. Both conflict with the
 * rule that a visitor's IP is hashed and discarded before an event is ever
 * constructed.
 *
 * Keying on the autonomous system number avoids the conflict entirely:
 *   - ingest already resolves ASN from the in-memory MaxMind database and
 *     stores it on the event, so no new data is collected;
 *   - an ASN identifies a *network operator*, not a person, so the lookup key
 *     is infrastructure metadata rather than personal data;
 *   - a company's netblocks share an ASN, so the resolution is the same one an
 *     IP -> company provider would perform internally.
 *
 * The tradeoff is honest: this identifies companies large enough to run their
 * own AS, and misses those on a generic business broadband range. It never
 * misidentifies a residential visitor as their ISP, because consumer ISP and
 * hosting ASNs are filtered out explicitly.
 */

const WATERMARK = "enrichment";
const LOOKUP_TIMEOUT_MS = 8000;

/** ASN types that identify an organization rather than a consumer network. */
const ORGANIZATION_TYPES = new Set(["business", "education", "government"]);

interface AsnRow {
  asn: number;
  asn_org: string;
  people: number;
}

interface IpinfoAsn {
  asn?: string;
  name?: string;
  domain?: string;
  country?: string;
  type?: string;
}

export async function enrichCompanies(
  context: WorkerContext,
  watermarks: Watermarks,
): Promise<number> {
  if (!context.projectIds.length) return 0;

  const token = process.env.IPINFO_TOKEN ?? "";
  const since = await watermarks.get(WATERMARK, 7 * 86_400_000);
  const now = Date.now();

  const result = await context.clickhouse.query({
    query: `
      SELECT
          asn,
          any(asn_org)              AS asn_org,
          uniqCombined64(person_id) AS people
      FROM events
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND ingested_at >= {since:DateTime}
        AND asn != 0
        AND is_bot = 0
      GROUP BY asn
      ORDER BY people DESC
      LIMIT 500
    `,
    query_params: { projectIds: context.projectIds, since: chDateTime(since).slice(0, 19) },
    format: "JSONEachRow",
  });

  const rows = await result.json<AsnRow>();
  if (!rows.length) {
    await watermarks.set(WATERMARK, now);
    return 0;
  }

  let resolved = 0;
  for (const row of rows) {
    try {
      const company = await resolveAsn(context, row, token);
      if (company) {
        await attachPeopleToCompany(context, row.asn, company.id, since);
        resolved++;
      }
    } catch (error) {
      console.error(`[enrichment] AS${row.asn} failed:`, String(error));
    }
  }

  await watermarks.set(WATERMARK, now);
  if (resolved) console.log(`[enrichment] resolved ${resolved} organizations from ${rows.length} ASNs`);
  return resolved;
}

/**
 * Resolve one ASN to a company row, or null if it is not an organization.
 *
 * Results are cached in the `companies` table — including negative results, so
 * a consumer ISN seen on every second pageview is looked up once rather than
 * repeatedly billed.
 */
async function resolveAsn(
  context: WorkerContext,
  row: AsnRow,
  token: string,
): Promise<{ id: string } | null> {
  const cacheKey = `as${row.asn}`;

  const [cached] = await context.db
    .select()
    .from(schema.companies)
    .where(eq(schema.companies.domain, cacheKey))
    .limit(1);

  if (cached?.enrichedAt) return { id: cached.id };
  if (cached?.lookupFailedAt) {
    // Re-check a failed lookup at most weekly.
    if (Date.now() - cached.lookupFailedAt.getTime() < 7 * 86_400_000) return null;
  }

  let info: IpinfoAsn | null = null;
  if (token) {
    info = await fetchAsn(row.asn, token);
  }

  // Without a provider token the ASN organization name from MaxMind is still a
  // usable signal — it is how the network registered itself. There is no
  // domain, so the row is keyed on the ASN.
  const isOrganization = info
    ? ORGANIZATION_TYPES.has((info.type ?? "").toLowerCase())
    : looksLikeOrganization(row.asn_org);

  if (!isOrganization) {
    await context.db
      .insert(schema.companies)
      .values({ domain: cacheKey, name: row.asn_org, lookupFailedAt: new Date(), raw: info ?? {} })
      .onConflictDoUpdate({
        target: schema.companies.domain,
        set: { lookupFailedAt: new Date(), name: row.asn_org },
      });
    return null;
  }

  const [company] = await context.db
    .insert(schema.companies)
    .values({
      domain: info?.domain || cacheKey,
      name: info?.name || row.asn_org,
      country: info?.country ?? null,
      website: info?.domain ? `https://${info.domain}` : null,
      raw: (info ?? { asn_org: row.asn_org }) as Record<string, unknown>,
      enrichedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.companies.domain,
      set: {
        name: info?.name || row.asn_org,
        enrichedAt: new Date(),
        lookupFailedAt: null,
      },
    })
    .returning();

  return company ? { id: company.id } : null;
}

async function fetchAsn(asn: number, token: string): Promise<IpinfoAsn | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`https://ipinfo.io/AS${asn}/json?token=${token}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as IpinfoAsn;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Heuristic fallback when no provider token is configured.
 *
 * Consumer ISPs and hosting providers overwhelmingly say so in their
 * registered name. This is deliberately conservative: a false negative just
 * means no company is attached, whereas a false positive would label a
 * residential visitor as working for their broadband provider.
 */
const CONSUMER_PATTERNS =
  /\b(telecom|telekom|broadband|mobile|wireless|cable|isp|internet services?|communications?|cellular|fibre|fiber|hosting|cloud|data ?cent(er|re)|vpn|colocation|digital ?ocean|amazon|google|microsoft|cloudflare|ovh|hetzner|linode|vultr|akamai|fastly)\b/i;

function looksLikeOrganization(asnOrg: string): boolean {
  if (!asnOrg || asnOrg.length < 3) return false;
  return !CONSUMER_PATTERNS.test(asnOrg);
}

/**
 * Attach every person seen on this ASN to the company.
 *
 * Only fills a null company: a person identified through a more reliable
 * signal (an explicit trait from identify(), say) should not be overwritten by
 * a network-level guess.
 */
async function attachPeopleToCompany(
  context: WorkerContext,
  asn: number,
  companyId: string,
  since: number,
): Promise<void> {
  const result = await context.clickhouse.query({
    query: `
      SELECT DISTINCT toString(person_id) AS person_id
      FROM events_v
      WHERE has({projectIds:Array(UInt32)}, project_id)
        AND timestamp >= {since:DateTime64(3)}
        AND asn = {asn:UInt32}
        AND is_bot = 0
      LIMIT 10000
    `,
    query_params: { projectIds: context.projectIds, since: chDateTime(since), asn },
    format: "JSONEachRow",
  });

  const people = (await result.json<{ person_id: string }>()).map((r) => r.person_id);
  if (!people.length) return;

  // Chunked: a single IN list with ten thousand UUIDs makes for an
  // unreasonably large statement.
  const CHUNK = 500;
  for (let i = 0; i < people.length; i += CHUNK) {
    await context.db
      .update(schema.persons)
      .set({ companyId, updatedAt: new Date() })
      .where(
        sql`${inArray(schema.persons.id, people.slice(i, i + CHUNK))} AND ${schema.persons.companyId} IS NULL`,
      );
  }
}
